//SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";

interface ILido {
    function submit(address _referral) external payable returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function sharesOf(address account) external view returns (uint256);

    function getPooledEthByShares(
        uint256 _sharesAmount
    ) external view returns (uint256);

    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);
}

contract LidoDirectInteractionTest is Test {
    // Holesky testnet Lido contract address (using the address you specified)
    address constant LIDO_ADDRESS = 0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034;
    address constant WSTETH_ADDRESS =
        0x8d09a4502Cc8Cf1547aD300E066060D043f6982D;

    // Test wallet - will act like the Receiver contract
    address testWallet;
    uint256 testWalletPrivateKey;

    // Amount to stake
    uint256 stakeAmount = 0.1 ether;

    function setUp() public {
        // Create a test wallet and fund it with ETH
        (testWallet, testWalletPrivateKey) = makeAddrAndKey("testWallet");
        vm.deal(testWallet, 1 ether);

        console.log("Test wallet address:", testWallet);
        console.log("Initial ETH balance:", testWallet.balance);
    }

    function testDirectStakeAndWrap() public {
        console.log("\n=== Testing Direct ETH Transfer with Balance Check ===");

        vm.startPrank(testWallet);

        // Get initial stETH balance
        uint256 initialStEthBalance = ILido(LIDO_ADDRESS).balanceOf(testWallet);
        console.log("Initial stETH balance:", initialStEthBalance);

        // This exactly matches your batchStakeWithLido implementation
        // Send ETH directly to Lido using low-level call
        (bool success, ) = payable(LIDO_ADDRESS).call{value: stakeAmount}("");

        if (success) {
            console.log("Direct ETH transfer successful");

            // Check received stETH balance - this is how your Receiver works
            uint256 currentStEthBalance = ILido(LIDO_ADDRESS).balanceOf(
                testWallet
            );
            uint256 stETHReceived = currentStEthBalance - initialStEthBalance;

            console.log("stETH received:", stETHReceived);

            if (stETHReceived > 0) {
                // Try to wrap the stETH to wstETH - just like your Receiver does
                try
                    ILido(LIDO_ADDRESS).approve(WSTETH_ADDRESS, stETHReceived)
                returns (bool approveSuccess) {
                    if (approveSuccess) {
                        console.log("Approved wstETH contract to spend stETH");

                        uint256 initialWstEthBalance = IWstETH(WSTETH_ADDRESS)
                            .balanceOf(testWallet);

                        try
                            IWstETH(WSTETH_ADDRESS).wrap(stETHReceived)
                        returns (uint256 wstETHReceived) {
                            console.log(
                                "Wrapped stETH to wstETH:",
                                wstETHReceived
                            );

                            // Verify actual balance increase
                            uint256 finalWstEthBalance = IWstETH(WSTETH_ADDRESS)
                                .balanceOf(testWallet);
                            console.log(
                                "wstETH balance increase:",
                                finalWstEthBalance - initialWstEthBalance
                            );
                        } catch Error(string memory reason) {
                            console.log(
                                "wstETH wrap failed with reason:",
                                reason
                            );
                        } catch (bytes memory) {
                            console.log(
                                "wstETH wrap failed with unknown error"
                            );
                        }
                    } else {
                        console.log("Failed to approve wstETH contract");
                    }
                } catch Error(string memory reason) {
                    console.log("stETH approval failed with reason:", reason);
                } catch (bytes memory) {
                    console.log("stETH approval failed with unknown error");
                }
            } else {
                console.log("No stETH received despite successful transfer");
            }
        } else {
            console.log("Direct ETH transfer failed");
        }

        vm.stopPrank();
    }

    function testFullReceiverFlow() public {
        console.log("\n=== Testing Full Receiver Flow Simulation ===");

        vm.startPrank(testWallet);

        // Track initial balances
        uint256 initialEthBalance = testWallet.balance;
        uint256 initialStEthBalance = ILido(LIDO_ADDRESS).balanceOf(testWallet);

        // STEP 1: Direct ETH transfer to Lido (like batchStakeWithLido does)
        (bool success, ) = payable(LIDO_ADDRESS).call{value: stakeAmount}("");
        require(success, "ETH transfer to Lido failed");

        // STEP 2: Check received stETH
        uint256 stETHReceived = ILido(LIDO_ADDRESS).balanceOf(testWallet) -
            initialStEthBalance;
        console.log("ETH sent:", stakeAmount);
        console.log("stETH received:", stETHReceived);

        // STEP 3: Approve and wrap stETH to wstETH
        ILido(LIDO_ADDRESS).approve(WSTETH_ADDRESS, stETHReceived);

        uint256 wstETHBefore = IWstETH(WSTETH_ADDRESS).balanceOf(testWallet);

        try IWstETH(WSTETH_ADDRESS).wrap(stETHReceived) returns (
            uint256 wstETHReceived
        ) {
            console.log("wstETH received from wrap:", wstETHReceived);

            // Verify actual wstETH balance change
            uint256 actualWstETHReceived = IWstETH(WSTETH_ADDRESS).balanceOf(
                testWallet
            ) - wstETHBefore;
            console.log(
                "Actual wstETH balance increase:",
                actualWstETHReceived
            );

            // This simulates the "return wstETHReceived" in your batchStakeWithLido function
            console.log("Final return value:", wstETHReceived);
        } catch Error(string memory reason) {
            console.log("wstETH wrap failed with reason:", reason);
        } catch (bytes memory) {
            console.log("wstETH wrap failed with unknown error");
        }

        vm.stopPrank();
    }
}
