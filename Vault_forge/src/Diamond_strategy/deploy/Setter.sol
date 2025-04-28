
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Setter {
    // Storage position for diamond storage
    bytes32 constant DIAMOND_STORAGE_POSITION = keccak256("diamond.standard.diamond.storage");
    
    // Storage structure that matches the actual Diamond storage layout
    struct VaultState {
        address owner;
        address swapContract;
        address receiverContract;
        // Other fields exist but we don't need them for our setter
    }
    
    // Modifier to restrict access to owner
    modifier onlyOwner() {
        require(msg.sender == 0x9aD95Ef94D945B039eD5E8059603119b61271486, "Not owner");
        _;
    }
    
    // Get diamond storage - this internal function can return a storage reference
    function diamondStorage() internal pure returns (VaultState storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }
    
    // Set the swap contract address
    function setSwapContract(address _swapContract) external onlyOwner {
        require(_swapContract != address(0), "Invalid address");
        VaultState storage ds = diamondStorage();
        ds.swapContract = _swapContract;
    }

    // Set the receiver contract address
    function setReceiverContract(address _receiverContract) external onlyOwner {
        require(_receiverContract != address(0), "Invalid address");
        VaultState storage ds = diamondStorage();
        ds.receiverContract = _receiverContract;
    }
}