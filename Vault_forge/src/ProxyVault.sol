// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProxyVault {
    address public immutable implementation;
    address public admin;

    // Storage slot for initialized flag
    bytes32 private constant INITIALIZED_SLOT = keccak256("proxy.initialized");

    constructor(address _implementation) {
        require(_implementation != address(0), "Implementation cannot be zero");
        implementation = _implementation;
        admin = msg.sender;
    }

    // Required for receiving ETH
    receive() external payable {
        _delegate(implementation);
    }

    fallback() external payable {
        _delegate(implementation);
    }

    function _delegate(address _implementation) internal {
        assembly {
            // Copy msg.data
            calldatacopy(0, 0, calldatasize())

            // Call implementation
            let result := delegatecall(
                gas(),
                _implementation,
                0,
                calldatasize(),
                0,
                0
            )

            // Copy return data
            returndatacopy(0, 0, returndatasize())

            // Forward result
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    // Helper function to check if the proxy is initialized
    function isInitialized() external view returns (bool) {
        bytes32 initializedSlot = INITIALIZED_SLOT;
        bool initialized;
        assembly {
            initialized := sload(initializedSlot)
        }
        return initialized;
    }
}
