// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {Yield_Bull} from "../src/Vault.sol";
import {Receiver} from "../src/Receiver_buffer/Receiver.sol";
import {SwapContract} from "../src/Swap_tokens/Swap.sol";

contract DeployProtocol is Script {
    // Configuration variables
    address lidoAddress;
    address wstETHAddress;
    address lidoWithdrawalAddress;
    address usdcAddress;
    address wethAddress;
    address uniswapRouterAddress;

    function run() public {
        // Load configuration based on chain
        string memory configFile = "config.json";
        string memory network = vm.envString("NETWORK");
        string memory root = string.concat(network, ".");

        // Load addresses
        lidoAddress = vm.parseJsonAddress(
            vm.readFile(configFile),
            string.concat(root, "lidoAddress")
        );
        wstETHAddress = vm.parseJsonAddress(
            vm.readFile(configFile),
            string.concat(root, "wstETHAddress")
        );
        lidoWithdrawalAddress = vm.parseJsonAddress(
            vm.readFile(configFile),
            string.concat(root, "lidoWithdrawalAddress")
        );
        usdcAddress = vm.parseJsonAddress(
            vm.readFile(configFile),
            string.concat(root, "usdcAddress")
        );
        wethAddress = vm.parseJsonAddress(
            vm.readFile(configFile),
            string.concat(root, "wethAddress")
        );
        uniswapRouterAddress = vm.parseJsonAddress(
            vm.readFile(configFile),
            string.concat(root, "uniswapRouterAddress")
        );

        // Get deployment private key
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy Receiver with placeholder for swap contract
        Receiver receiver = new Receiver(
            lidoAddress,
            wstETHAddress,
            address(1) // Temporary placeholder for swap contract
        );
        console.log("Receiver deployed to:", address(receiver));

        // Step 2: Deploy SwapContract with all required addresses
        SwapContract swapContract = new SwapContract(
            uniswapRouterAddress,
            usdcAddress,
            wethAddress,
            address(1), // Temporary placeholder for vault
            address(receiver)
        );
        console.log("SwapContract deployed to:", address(swapContract));

        // Step 3: Deploy Vault with all required addresses
        Yield_Bull vault = new Yield_Bull(
            lidoWithdrawalAddress,
            wstETHAddress,
            address(receiver),
            address(swapContract)
        );
        console.log("Vault deployed to:", address(vault));

        // Step 4: Update the references in all contracts

        // Update Receiver with correct references
        receiver.setSwapContract(address(swapContract));
        receiver.setVaultContract(address(vault));
        receiver.setLidoWithdrawalAddress(lidoWithdrawalAddress);

        // If SwapContract has a setVaultContract function, call it here
        // swapContract.setVaultContract(address(vault));

        vm.stopBroadcast();

        // Log all addresses for verification
        console.log("Deployment complete! Contract addresses:");
        console.log("Receiver:", address(receiver));
        console.log("SwapContract:", address(swapContract));
        console.log("Vault:", address(vault));
    }
}
