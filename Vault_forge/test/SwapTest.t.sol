// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";

// Import interfaces
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function decimals() external view returns (uint8);
}

interface ISwapRouter {
    function swapExactUSDCForETH(
        uint256 amountIn,
        address to
    ) external returns (uint256);

    function getETHAmountOut(
        uint256 usdcAmountIn
    ) external pure returns (uint256);

    function USDC() external view returns (address);

    function RATE_ETH_TO_USDC() external view returns (uint256);
}

contract SwapRouterTest is Test {
    // Contract addresses on Holesky
    address public constant SWAP_ADDRESS =
        0x5C7cda1d0784d0D662E772A2a5450EA48fd687e2;
    address public constant USDC_ADDRESS =
        0x06901fD3D877db8fC8788242F37c1A15f05CEfF8;
    address public constant RECEIVER_ADDRESS =
        0xd000d2399499aB96a3fa023c8964aFBB459AAE6D;

    // Contracts
    ISwapRouter public swapContract;
    IERC20 public usdcContract;

    // Test user
    address public testUser;
    uint256 public userPrivateKey;

    // Test amount (100 USDC)
    uint256 public usdcAmount = 100 * 10 ** 6; // USDC has 6 decimals

    function setUp() public {
        // Create and fund a test user
        (testUser, userPrivateKey) = makeAddrAndKey("testUser");
        vm.deal(testUser, 1 ether); // Fund with ETH for gas

        // Initialize contracts
        swapContract = ISwapRouter(SWAP_ADDRESS);
        usdcContract = IERC20(USDC_ADDRESS);

        // Fund test user with USDC using vm.store (direct storage manipulation)
        deal(address(usdcContract), testUser, usdcAmount);

        // Fund the swap contract with ETH so it can perform the swap
        vm.deal(SWAP_ADDRESS, 10 ether);
    }

    function testSwapExactUSDCForETH() public {
        vm.startPrank(testUser);

        // STEP 1: Verification of initial state
        uint256 initialUserUSDCBalance = usdcContract.balanceOf(testUser);
        uint256 initialUserETHBalance = testUser.balance;
        uint256 initialSwapETHBalance = address(swapContract).balance;

        console.log(
            "Initial USDC balance:",
            initialUserUSDCBalance / 10 ** 6,
            "USDC"
        );
        console.log(
            "Initial user ETH balance:",
            initialUserETHBalance / 10 ** 18,
            "ETH"
        );
        console.log(
            "Initial swap contract ETH balance:",
            initialSwapETHBalance / 10 ** 18,
            "ETH"
        );

        // STEP 2: Get expected ETH amount from the swap
        uint256 expectedETHAmount = swapContract.getETHAmountOut(usdcAmount);
        console.log(
            "Expected ETH amount:",
            expectedETHAmount / 10 ** 18,
            "ETH"
        );

        // STEP 3: Approve USDC spending
        usdcContract.approve(SWAP_ADDRESS, usdcAmount);
        console.log("USDC approved for swap");

        // STEP 4: Execute swap - send directly to testUser
        console.log(
            "Executing swap of",
            usdcAmount / 10 ** 6,
            "USDC for ETH..."
        );
        uint256 ethReceived = swapContract.swapExactUSDCForETH(
            usdcAmount,
            testUser
        );
        console.log(
            "Swap executed! ETH received:",
            ethReceived / 10 ** 18,
            "ETH"
        );

        // STEP 5: Verify results
        uint256 finalUserUSDCBalance = usdcContract.balanceOf(testUser);
        uint256 finalUserETHBalance = testUser.balance;
        uint256 finalSwapETHBalance = address(swapContract).balance;

        console.log("\nVerifying results:");
        console.log(
            "Final USDC balance:",
            finalUserUSDCBalance / 10 ** 6,
            "USDC"
        );
        console.log(
            "Final user ETH balance:",
            finalUserETHBalance / 10 ** 18,
            "ETH"
        );
        console.log(
            "Final swap contract ETH balance:",
            finalSwapETHBalance / 10 ** 18,
            "ETH"
        );

        // Calculate actual changes
        uint256 usdcSpent = initialUserUSDCBalance - finalUserUSDCBalance;
        uint256 ethGained = finalUserETHBalance - initialUserETHBalance;
        uint256 swapEthReduced = initialSwapETHBalance - finalSwapETHBalance;

        console.log("USDC spent:", usdcSpent / 10 ** 6);
        console.log("ETH gained:", ethGained / 10 ** 18);
        console.log("Swap ETH reduced:", swapEthReduced / 10 ** 18);

        // Assertions to verify correct behavior
        assertEq(usdcSpent, usdcAmount, "Wrong USDC amount spent");
        assertEq(ethGained, expectedETHAmount, "Wrong ETH amount received");
        assertEq(
            swapEthReduced,
            expectedETHAmount,
            "Swap ETH reduction doesn't match"
        );
        assertEq(
            ethReceived,
            expectedETHAmount,
            "Return value doesn't match actual ETH received"
        );

        // Test sending to different recipient
        address recipient = address(0x123);
        vm.deal(recipient, 0.01 ether); // Give recipient a tiny bit of ETH for gas calculation
        uint256 initialRecipientETH = recipient.balance;

        // Fund user with more USDC for second test
        deal(address(usdcContract), testUser, usdcAmount);
        usdcContract.approve(SWAP_ADDRESS, usdcAmount);

        // Execute swap sending ETH to recipient
        ethReceived = swapContract.swapExactUSDCForETH(usdcAmount, recipient);

        // Verify recipient received the ETH
        assertEq(
            recipient.balance - initialRecipientETH,
            expectedETHAmount,
            "Recipient didn't receive ETH"
        );

        vm.stopPrank();
    }

    // Test edge cases
    function testZeroAmountSwap() public {
        vm.startPrank(testUser);

        // Should revert with a specific error
        vm.expectRevert("USDCETHRouter: ZERO_USDC_INPUT");
        swapContract.swapExactUSDCForETH(0, testUser);

        vm.stopPrank();
    }

    function testInsufficientETHInSwapContract() public {
        // First make sure we have a large USDC amount to test with
        uint256 largeAmount = 5000 * 10 ** 6; // 5000 USDC

        // IMPORTANT: Override the ETH balance of the swap contract to be near zero
        // This is the proper way to "drain" ETH in Foundry tests
        vm.deal(SWAP_ADDRESS, 0.001 ether); // Just enough for gas fees but not for a large swap

        // Verify the balance is very low
        console.log(
            "Swap contract ETH balance:",
            address(swapContract).balance / 10 ** 18,
            "ETH"
        );

        // Now we can proceed as the test user
        vm.startPrank(testUser);

        // Fund test user with the large USDC amount
        deal(address(usdcContract), testUser, largeAmount);

        // Check USDC balance
        console.log(
            "User USDC balance:",
            usdcContract.balanceOf(testUser) / 10 ** 6,
            "USDC"
        );

        // Approve USDC
        usdcContract.approve(SWAP_ADDRESS, largeAmount);

        // Get the expected ETH out for the USDC amount
        uint256 expectedEthOut = swapContract.getETHAmountOut(largeAmount);
        console.log("Expected ETH out:", expectedEthOut / 10 ** 18, "ETH");

        // Verify the swap contract doesn't have enough ETH
        require(
            address(swapContract).balance < expectedEthOut,
            "Swap contract has enough ETH, test invalid"
        );

        // Now the swap should revert with insufficient ETH
        vm.expectRevert("USDCETHRouter: INSUFFICIENT_ETH_BALANCE");
        swapContract.swapExactUSDCForETH(largeAmount, testUser);

        vm.stopPrank();
    }

    // Add this to your test
    function testLargeSwap() public {
        vm.startPrank(testUser);

        uint256 largeAmount = 10000 * 10 ** 6; // 10,000 USDC
        deal(address(usdcContract), testUser, largeAmount);

        console.log("Rate USDC per ETH:", swapContract.RATE_ETH_TO_USDC());
        console.log(
            "Expected ETH for 10,000 USDC:",
            swapContract.getETHAmountOut(largeAmount) / 10 ** 18
        );

        usdcContract.approve(SWAP_ADDRESS, largeAmount);
        uint256 received = swapContract.swapExactUSDCForETH(
            largeAmount,
            testUser
        );
        console.log("Actual ETH received:", received / 10 ** 18);

        vm.stopPrank();
    }
}
