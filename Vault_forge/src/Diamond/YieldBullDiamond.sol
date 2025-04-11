// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";

contract YieldBullDiamond {
    event FacetChanged(
        bytes4 indexed functionSelector,
        address indexed facetAddress
    );

    // Store function selector -> implementation mapping
    mapping(bytes4 => address) private _facets;

    constructor(address _owner) {
        // Initialize ownership
        DiamondStorage.VaultState storage state = DiamondStorage.getStorage();
        state.owner = _owner;
    }

    // Function to register facet implementations
    function setFacet(bytes4 _selector, address _implementation) external {
        // Only owner check
        DiamondStorage.VaultState storage state = DiamondStorage.getStorage();
        require(msg.sender == state.owner, "Not authorized");

        _facets[_selector] = _implementation;
    }

    // Catch all function calls and delegate to appropriate facet
    fallback() external payable {
        address facet = _facets[msg.sig];
        require(facet != address(0), "Function not found");

        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {}

    function setBatchFacets(
        bytes4[] calldata _selectors,
        address[] calldata _implementations
    ) external {
        DiamondStorage.VaultState storage state = DiamondStorage.getStorage();
        require(msg.sender == state.owner, "Not authorized");
        require(
            _selectors.length == _implementations.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < _selectors.length; i++) {
            _facets[_selectors[i]] = _implementations[i];
            emit FacetChanged(_selectors[i], _implementations[i]);
        }
    }
}
