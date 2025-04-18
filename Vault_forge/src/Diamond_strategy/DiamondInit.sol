// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";

contract DiamondInit {
    function init(
        address _lidoWithdrawal,
        address _wstETH,
        address _receiver,
        address _swapContract,
        address _assetToken
    ) external {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        // Initialize storage
        require(
            _lidoWithdrawal != address(0),
            "Invalid Lido withdrawal address"
        );
        require(_wstETH != address(0), "Invalid wstETH address");
        require(_receiver != address(0), "Invalid receiver address");
        require(_swapContract != address(0), "Invalid swap contract address");
        require(_assetToken != address(0), "Invalid asset token address");

        ds.lidoWithdrawalAddress = _lidoWithdrawal;
        ds.wstETHAddress = _wstETH;
        ds.receiverContract = _receiver;
        ds.swapContract = _swapContract;
        ds.ASSET_TOKEN_ADDRESS = _assetToken;
        ds.feeCollector = msg.sender;
        ds.lastDailyUpdate = block.timestamp;
    }
}