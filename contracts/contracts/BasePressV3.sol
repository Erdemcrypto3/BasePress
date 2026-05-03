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
 * @title BasePress V3 — adds per-article revocation, CEI hardening, withdraw pause
 * @author 2e2c
 * @custom:oz-upgrades-from BasePress
 *
 * Wave 3 audit bundle (single UUPS upgrade on Base + Ink):
 *   PAI-0001 (H-02): on-chain permit revocation via revokedArticles mapping
 *   PAI-0005 (M-01): CEI — _mint moved to end of mintWithPermit
 *   PAI-0006 (M-02): permit.author validated against address(0) and address(this)
 *   PAI-0007 (M-03): withdrawals gated by whenNotPaused (pause = full freeze)
 *   PAI-0008 (M-04): pragma pinned 0.8.24 (no caret)
 *
 * Storage is APPEND-ONLY vs V2: revokedArticles is the only new state slot.
 */
contract BasePressV3 is
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
        string contentURI;
        address author;
        uint256 price;
        uint256 maxSupply;
        uint256 deadline;
    }

    struct ArticleState {
        address author;
        uint256 totalMinted;
        uint256 maxSupply;
        bool initialized;
    }

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
    error MaxSupplyReached();
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
        if (msg.value != permit.price) revert IncorrectPayment();

        bytes32 digest = hashPermit(permit);
        address signer = digest.recover(signature);
        if (signer != platformSigner) revert InvalidSignature();

        ArticleState storage a = articles[permit.articleId];

        if (!a.initialized) {
            a.author = permit.author;
            a.maxSupply = permit.maxSupply;
            a.initialized = true;
        }
        if (a.author != permit.author) revert InvalidSignature();
        if (a.maxSupply != permit.maxSupply) revert InvalidSignature();

        if (permit.maxSupply != 0 && a.totalMinted + 1 > permit.maxSupply) {
            revert MaxSupplyReached();
        }

        // PAI-0005 — CEI: ALL effects (supply + balances) before _mint interaction.
        a.totalMinted += 1;
        uint256 fee = (permit.price * platformFeeBps) / 10000;
        uint256 authorShare = permit.price - fee;
        platformBalance += fee;
        authorBalances[a.author] += authorShare;

        // Interaction last — _mint triggers onERC1155Received on contract recipients.
        _mint(msg.sender, uint256(permit.articleId), 1, "");

        emit ArticleMinted(permit.articleId, msg.sender, a.author, permit.price, a.totalMinted);
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
    //                          STORAGE GAP (V3 → V4+)
    // =========================================================================

    // P001-PAI-0031: reserve storage slots for future upgrades
    uint256[49] private __gap;
}
