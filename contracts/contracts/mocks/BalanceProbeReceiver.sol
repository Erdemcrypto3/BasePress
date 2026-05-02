// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title BalanceProbeReceiver
 * @notice Test mock that records balance state observed during the ERC-1155
 *         onERC1155Received callback. Used to prove CEI ordering (PAI-0005):
 *         when _mint triggers this callback, author/platform balances should
 *         ALREADY be credited.
 */
contract BalanceProbeReceiver is IERC1155Receiver {
    // Balance state observed during the most recent onERC1155Received callback
    uint256 public lastObservedAuthorBalance;
    uint256 public lastObservedPlatformBalance;
    address public targetContract;
    address public probeAuthor;

    constructor(address _target, address _probeAuthor) {
        targetContract = _target;
        probeAuthor = _probeAuthor;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        // PAI-0005: Read balances from BasePress contract during callback.
        // If CEI is correct, balances are credited BEFORE _mint triggers this.
        (bool s1, bytes memory d1) = targetContract.call(
            abi.encodeWithSignature("authorBalances(address)", probeAuthor)
        );
        if (s1 && d1.length >= 32) {
            lastObservedAuthorBalance = abi.decode(d1, (uint256));
        }

        (bool s2, bytes memory d2) = targetContract.call(
            abi.encodeWithSignature("platformBalance()")
        );
        if (s2 && d2.length >= 32) {
            lastObservedPlatformBalance = abi.decode(d2, (uint256));
        }

        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    // Allow receiving ETH so tests can fund this contract before impersonation
    receive() external payable {}
}
