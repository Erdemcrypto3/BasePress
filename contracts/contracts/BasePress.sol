// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BasePress V2 — Multichain decentralized blog with off-chain publish
 * @author 2e2c
 * @notice Articles live off-chain (Cloudflare R2). The platform signer attests
 *         each article via an EIP-712 MintPermit. Readers mint by submitting
 *         the permit + signature; the contract verifies the signer and lazily
 *         registers the article state on first mint.
 *
 *         Same code, multiple chains: deploy this contract to Base, Ink, OP,
 *         Arbitrum, etc. The same off-chain permit can be replayed on any
 *         chain — readers pick where to mint.
 *
 * Revenue split: platformFeeBps to platformBalance, remainder to permit.author.
 *
 * Differences from V1:
 *   - publishArticle / approveAuthor REMOVED (publish is off-chain, gas-free)
 *   - mintWithPermit ADDED (EIP-712 verified, lazy article init)
 *   - articleId is bytes32 (off-chain content hash) instead of uint256 counter
 *   - One platformSigner address authorizes all articles
 */
contract BasePress is
    Initializable,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    EIP712Upgradeable
{
    using ECDSA for bytes32;

    // =========================================================================
    //                                STRUCTS
    // =========================================================================

    struct MintPermit {
        bytes32 articleId;     // off-chain content hash / slug-derived id
        string contentURI;     // R2 URL or ipfs:// (informational, not enforced on-chain)
        address author;        // recipient of (price - platform fee)
        uint256 price;         // wei per single mint
        uint256 maxSupply;     // 0 = unlimited
        uint256 deadline;      // unix seconds; 0 = no expiry
    }

    struct ArticleState {
        address author;        // captured on first mint, immutable thereafter
        uint256 totalMinted;
        uint256 maxSupply;     // captured on first mint
        bool initialized;
    }

    // =========================================================================
    //                            STATE VARIABLES
    // =========================================================================

    address public platformSigner;
    address public platformTreasury;
    uint256 public platformFeeBps;            // basis points, e.g. 500 = 5%
    bool public upgradesRenounced;

    mapping(bytes32 => ArticleState) public articles;
    mapping(address => uint256) public authorBalances;
    uint256 public platformBalance;

    string public blogName;

    // =========================================================================
    //                                EVENTS
    // =========================================================================

    event ArticleMinted(
        bytes32 indexed articleId,
        address indexed minter,
        address indexed author,
        uint256 price,
        uint256 totalMinted
    );
    event PlatformSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event PlatformTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PlatformFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event AuthorWithdrawal(address indexed author, uint256 amount);
    event PlatformWithdrawal(address indexed to, uint256 amount);
    event UpgradesRenounced();

    // =========================================================================
    //                                ERRORS
    // =========================================================================

    error InvalidSignature();
    error PermitExpired();
    error MaxSupplyReached();
    error IncorrectPayment();
    error ZeroAddress();
    error FeeTooHigh();
    error NothingToWithdraw();
    error TransferFailed();
    error UpgradesAlreadyRenounced();

    // =========================================================================
    //                              INITIALIZER
    // =========================================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _platformSigner,
        address _platformTreasury,
        uint256 _platformFeeBps,
        string memory _blogName,
        string memory _baseUri
    ) public initializer {
        if (_owner == address(0) || _platformSigner == address(0) || _platformTreasury == address(0)) {
            revert ZeroAddress();
        }
        if (_platformFeeBps > 1000) revert FeeTooHigh(); // hard cap 10%

        __ERC1155_init(_baseUri);
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __EIP712_init("BasePress", "1");

        platformSigner = _platformSigner;
        platformTreasury = _platformTreasury;
        platformFeeBps = _platformFeeBps;
        blogName = _blogName;
    }

    // =========================================================================
    //                            EIP-712 PERMIT HASH
    // =========================================================================

    bytes32 private constant MINT_PERMIT_TYPEHASH = keccak256(
        "MintPermit(bytes32 articleId,string contentURI,address author,uint256 price,uint256 maxSupply,uint256 deadline)"
    );

    function hashPermit(MintPermit calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MINT_PERMIT_TYPEHASH,
                    p.articleId,
                    keccak256(bytes(p.contentURI)),
                    p.author,
                    p.price,
                    p.maxSupply,
                    p.deadline
                )
            )
        );
    }

    // =========================================================================
    //                                MINT
    // =========================================================================

    /**
     * @notice Mint an article NFT. The permit must be signed by platformSigner.
     *         First mint of an articleId initializes its state (author, max supply).
     *         Subsequent mints validate against that initial state.
     */
    function mintWithPermit(MintPermit calldata permit, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (permit.deadline != 0 && block.timestamp > permit.deadline) revert PermitExpired();
        if (msg.value != permit.price) revert IncorrectPayment();

        // Verify the platform attested this article + price + author + supply.
        bytes32 digest = hashPermit(permit);
        address signer = digest.recover(signature);
        if (signer != platformSigner) revert InvalidSignature();

        ArticleState storage a = articles[permit.articleId];

        if (!a.initialized) {
            // First mint — lock author and max supply from the permit forever.
            a.author = permit.author;
            a.maxSupply = permit.maxSupply;
            a.initialized = true;
        }
        // For subsequent mints, the permit's author/maxSupply must equal the
        // values captured on first mint, otherwise the platform could double-
        // sign the same articleId with different terms.
        if (a.author != permit.author) revert InvalidSignature();
        if (a.maxSupply != permit.maxSupply) revert InvalidSignature();

        if (permit.maxSupply != 0 && a.totalMinted + 1 > permit.maxSupply) {
            revert MaxSupplyReached();
        }

        a.totalMinted += 1;

        // Token id = uint256(articleId).
        _mint(msg.sender, uint256(permit.articleId), 1, "");

        // Revenue split.
        uint256 fee = (permit.price * platformFeeBps) / 10000;
        uint256 authorShare = permit.price - fee;
        platformBalance += fee;
        authorBalances[a.author] += authorShare;

        emit ArticleMinted(permit.articleId, msg.sender, a.author, permit.price, a.totalMinted);
    }

    // =========================================================================
    //                              WITHDRAWALS
    // =========================================================================

    function withdrawAuthor() external nonReentrant {
        uint256 amount = authorBalances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        authorBalances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit AuthorWithdrawal(msg.sender, amount);
    }

    function withdrawPlatform() external nonReentrant {
        uint256 amount = platformBalance;
        if (amount == 0) revert NothingToWithdraw();
        platformBalance = 0;
        (bool ok, ) = platformTreasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PlatformWithdrawal(platformTreasury, amount);
    }

    // =========================================================================
    //                            ADMIN (OWNER)
    // =========================================================================

    function setPlatformSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit PlatformSignerUpdated(platformSigner, newSigner);
        platformSigner = newSigner;
    }

    function setPlatformTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit PlatformTreasuryUpdated(platformTreasury, newTreasury);
        platformTreasury = newTreasury;
    }

    function setPlatformFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > 1000) revert FeeTooHigh();
        emit PlatformFeeUpdated(platformFeeBps, newFeeBps);
        platformFeeBps = newFeeBps;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setURI(string calldata newUri) external onlyOwner { _setURI(newUri); }

    function renounceUpgrades() external onlyOwner {
        if (upgradesRenounced) revert UpgradesAlreadyRenounced();
        upgradesRenounced = true;
        emit UpgradesRenounced();
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (upgradesRenounced) revert UpgradesAlreadyRenounced();
    }

    // =========================================================================
    //                                 VIEWS
    // =========================================================================

    function articleSupply(bytes32 articleId) external view returns (uint256) {
        return articles[articleId].totalMinted;
    }

    function articleAuthor(bytes32 articleId) external view returns (address) {
        return articles[articleId].author;
    }
}
