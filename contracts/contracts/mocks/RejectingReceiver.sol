// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBasePressMin {
    function withdrawAuthor() external;
    function withdrawPlatform() external;
}

contract RejectingReceiver {
    function callWithdrawAuthor(address bp) external {
        IBasePressMin(bp).withdrawAuthor();
    }

    function callWithdrawPlatform(address bp) external {
        IBasePressMin(bp).withdrawPlatform();
    }

    receive() external payable {
        revert("ETH rejected");
    }
}
