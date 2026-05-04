// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BasePress V4 — simplified permit: fixed price, unlimited supply, no contentURI
 * @author 2e2c
 * @custom:oz-upgrades-from BasePressV3
 *
 * V4 changes:
 *   - MintPermit reduced to 3 fields: articleId, author, deadline
 *   - contentURI removed from permit (stored off-chain only)
 *   - mintPrice hardcoded as constant: 0.001 ether (no setter, no storage)
 *   - maxSupply removed — unlimited mints per article
 *   - ArticleState struct fields unchanged in storage for layout compatibility
 *     (V4 simply ignores maxSupply)
 *
 * Storage is UNCHANGED vs V3: no new state slots added.
 */
contract BasePressV4 is
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
        bytes32 articleId;
        address author;
        uint256 deadline;
    }

    // Storage layout struct — kept identical to V3 for UUPS compatibility.
    // V4 never reads/writes maxSupply but the slot must remain.
    struct ArticleState {
        address author;
        uint256 totalMinted;
        uint256 maxSupply;
        bool initialized;
    }

    // =========================================================================
    //                              CONSTANTS
    // =========================================================================

    uint256 public constant MINT_PRICE = 0.001 ether;

    // =========================================================================
    //                            STATE VARIABLES (V2)
    // =========================================================================

    address public platformSigner;
    address public platformTreasury;
    uint256 public platformFeeBps;
    bool public upgradesRenounced;

    mapping(bytes32 => ArticleState) public articles;
    mapping(address => uint256) public authorBalances;
    uint256 public platformBalance;

    string public blogName;

    // =========================================================================
    //                          STATE VARIABLES (V3 — APPEND ONLY)
    // =========================================================================

    // PAI-0001 — irreversible per-article kill switch for signed permits.
    mapping(bytes32 => bool) public revokedArticles;

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
    // PAI-0001
    event ArticleRevoked(bytes32 indexed articleId, address indexed by);

    // =========================================================================
    //                                ERRORS
    // =========================================================================

    error InvalidSignature();
    error PermitExpired();
    error IncorrectPayment();
    error ZeroAddress();
    error FeeTooHigh();
    error NothingToWithdraw();
    error TransferFailed();
    error UpgradesAlreadyRenounced();
    // PAI-0001
    error PermitRevoked();
    // PAI-0006
    error InvalidAuthor();

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
        if (_platformFeeBps > 1000) revert FeeTooHigh();

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
        "MintPermit(bytes32 articleId,address author,uint256 deadline)"
    );

    function hashPermit(MintPermit calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MINT_PERMIT_TYPEHASH,
                    p.articleId,
                    p.author,
                    p.deadline
                )
            )
        );
    }

    // =========================================================================
    //                                MINT
    // =========================================================================

    function mintWithPermit(MintPermit calldata permit, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        // PAI-0001 — block revoked articles before any other work.
        if (revokedArticles[permit.articleId]) revert PermitRevoked();

        // PAI-0006 — defensive author validation (signer is the SPOF without this).
        if (permit.author == address(0)) revert ZeroAddress();
        if (permit.author == address(this)) revert InvalidAuthor();

        if (permit.deadline != 0 && block.timestamp > permit.deadline) revert PermitExpired();
        if (msg.value != MINT_PRICE) revert IncorrectPayment();

        bytes32 digest = hashPermit(permit);
        address signer = digest.recover(signature);
        if (signer != platformSigner) revert InvalidSignature();

        ArticleState storage a = articles[permit.articleId];

        if (!a.initialized) {
            a.author = permit.author;
            a.initialized = true;
        }
        if (a.author != permit.author) revert InvalidSignature();

        // V4: no maxSupply check — unlimited mints

        // CEI: ALL effects (supply + balances) before _mint interaction.
        a.totalMinted += 1;
        uint256 fee = (MINT_PRICE * platformFeeBps) / 10000;
        uint256 authorShare = MINT_PRICE - fee;
        platformBalance += fee;
        authorBalances[a.author] += authorShare;

        // Interaction last — _mint triggers onERC1155Received on contract recipients.
        _mint(msg.sender, uint256(permit.articleId), 1, "");

        emit ArticleMinted(permit.articleId, msg.sender, a.author, MINT_PRICE, a.totalMinted);
    }

    // =========================================================================
    //                              WITHDRAWALS
    // =========================================================================

    // PAI-0007 — pause is a fire alarm: freezes BOTH credit (mint) AND debit (withdraw).
    function withdrawAuthor() external nonReentrant whenNotPaused {
        uint256 amount = authorBalances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        authorBalances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit AuthorWithdrawal(msg.sender, amount);
    }

    // P001-PAI-0034: restrict platform withdrawal to owner — prevents griefing / forced withdrawals
    function withdrawPlatform() external onlyOwner nonReentrant whenNotPaused {
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

    // PAI-0001 — irreversible by design; no unrevoke. Defends against accidental re-enable via re-sign.
    function revokeArticle(bytes32 articleId) external onlyOwner {
        if (revokedArticles[articleId]) return;
        revokedArticles[articleId] = true;
        emit ArticleRevoked(articleId, msg.sender);
    }

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

    function isArticleRevoked(bytes32 articleId) external view returns (bool) {
        return revokedArticles[articleId];
    }

    // =========================================================================
    //                          STORAGE GAP (V4 → V5+)
    // =========================================================================

    // No new storage slots added in V4 (MINT_PRICE is a constant in bytecode).
    // Gap stays at 49 to match V3.
    uint256[49] private __gap;
}
