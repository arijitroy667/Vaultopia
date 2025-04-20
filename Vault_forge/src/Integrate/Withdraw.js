require('dotenv').config({ path: '../../../.env' });
const ethers = require('ethers');

// ABI snippets for the functions we need
const DIAMOND_ABI = [
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function balanceOf(address user) external view returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
  "function previewWithdraw(uint256 assets) public view returns (uint256 shares)",
  "function getWithdrawableAmount(address user) external view returns (uint256)",
  "function getLockedAmount(address user) external view returns (uint256)",
  "function getUnlockTime(address user) external view returns (uint256[])",
  "function getNearestUnlockTime(address user) external view returns (uint256)",
  "function maxWithdraw(address owner) external view returns (uint256)"
];

// Connect to the network
async function connectToNetwork() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_ALCHEMY_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Connected with address: ${wallet.address}`);
  return { provider, wallet };
}

// Connect to contracts
async function connectToContracts(wallet) {
  const diamondAddress = process.env.NEXT_PUBLIC_DIAMOND_ADDRESS;
  
  const diamondContract = new ethers.Contract(diamondAddress, DIAMOND_ABI, wallet);
  console.log(`Connected to Diamond at: ${diamondAddress}`);
  
  return { diamondContract };
}

// Check vault shares balance
async function checkVaultShares(diamondContract, address) {
  const shares = await diamondContract.balanceOf(address);
  const assets = await diamondContract.convertToAssets(shares);
  console.log(`Vault Balance: ${ethers.utils.formatUnits(shares)} shares (${ethers.utils.formatUnits(assets, 6)} USDC equivalent)`);
  return { shares, assets };
}

// Check withdrawable amount
async function checkWithdrawableAmount(diamondContract, address) {
  const withdrawable = await diamondContract.getWithdrawableAmount(address);
  console.log(`Withdrawable Amount: ${ethers.utils.formatUnits(withdrawable, 6)} USDC`);
  
  const lockedAmount = await diamondContract.getLockedAmount(address);
  console.log(`Locked Amount: ${ethers.utils.formatUnits(lockedAmount, 6)} USDC`);
  
  return { withdrawable, lockedAmount };
}

// Get unlock times for locked deposits
async function getUnlockTimes(diamondContract, address) {
  const unlockTimes = await diamondContract.getUnlockTime(address);
  
  if (unlockTimes.length === 0) {
    console.log('No locked deposits found.');
    return [];
  }
  
  console.log('Unlock times for deposits:');
  const currentTimestamp = Math.floor(Date.now() / 1000);
  
  unlockTimes.forEach((timestamp, index) => {
    const unlockDate = new Date(timestamp.toNumber() * 1000);
    const remainingTime = timestamp.toNumber() - currentTimestamp;
    
    if (remainingTime > 0) {
      const days = Math.floor(remainingTime / 86400);
      const hours = Math.floor((remainingTime % 86400) / 3600);
      console.log(`  Deposit ${index + 1}: Unlocks on ${unlockDate.toLocaleString()} (${days}d ${hours}h remaining)`);
    } else {
      console.log(`  Deposit ${index + 1}: Already unlocked on ${unlockDate.toLocaleString()}`);
    }
  });
  
  return unlockTimes;
}

// Check max withdraw
async function checkMaxWithdraw(diamondContract, address) {
  const maxWithdraw = await diamondContract.maxWithdraw(address);
  console.log(`Max Withdrawal: ${ethers.utils.formatUnits(maxWithdraw, 6)} USDC`);
  return maxWithdraw;
}

// Preview withdraw (calculate shares needed)
async function previewWithdraw(diamondContract, amount) {
  const requiredShares = await diamondContract.previewWithdraw(amount);
  console.log(`Shares required for withdrawal: ${ethers.utils.formatUnits(requiredShares)}`);
  return requiredShares;
}

// Withdraw funds from the vault
async function withdraw(diamondContract, amount, receiver, owner, feeData) {
  console.log(`Initiating withdrawal of ${ethers.utils.formatUnits(amount, 6)} USDC...`);
  
  // Check withdrawable amount
  const { withdrawable } = await checkWithdrawableAmount(diamondContract, owner);
  if (withdrawable.lt(amount)) {
    console.error(`Amount exceeds withdrawable limit. Maximum: ${ethers.utils.formatUnits(withdrawable, 6)} USDC`);
    return false;
  }
  
  // Calculate required shares
  const requiredShares = await previewWithdraw(diamondContract, amount);
  
  // Check if user has enough shares
  const { shares } = await checkVaultShares(diamondContract, owner);
  if (shares.lt(requiredShares)) {
    console.error(`Insufficient shares. Required: ${ethers.utils.formatUnits(requiredShares)}, Available: ${ethers.utils.formatUnits(shares)}`);
    return false;
  }
  
  // Execute withdrawal
  try {
    console.log(`Executing withdrawal...`);
    const tx = await diamondContract.withdraw(amount, receiver, owner, {
      gasLimit: 1000000, // Higher gas limit for complex operations
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });
    console.log(`Withdrawal transaction sent: ${tx.hash}`);
    await tx.wait(3);
    console.log(`Withdrawal successful!`);
    
    // Check updated balances
    await checkVaultShares(diamondContract, owner);
    
    return true;
  } catch (error) {
    if (error.message.includes("Amount exceeds unlocked balance")) {
      console.error(`Error: You're trying to withdraw locked funds. Check unlock times.`);
      await getUnlockTimes(diamondContract, owner);
    } else {
      console.error(`Error during withdrawal: ${error.message}`);
    }
    return false;
  }
}

// Process completed withdrawals for staked portions
async function processCompletedWithdrawal(diamondContract, minExpectedUSDC, feeData) {
  console.log(`Processing completed withdrawal...`);
  
  try {
    // Minimum expected USDC with 5% slippage tolerance
    const tx = await diamondContract.processCompletedWithdrawals(
      diamondContract.signer.address, 
      minExpectedUSDC,
      {
        gasLimit: 2000000, // Higher gas limit for complex operations
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      }
    );
    
    console.log(`Process withdrawal transaction sent: ${tx.hash}`);
    await tx.wait(3);
    console.log(`Withdrawal processing successful!`);
    
    // Check updated balances
    await checkVaultShares(diamondContract, diamondContract.signer.address);
    
    return true;
  } catch (error) {
    if (error.message.includes("NoWithdrawalInProgress")) {
      console.error(`No withdrawal is in progress for your address.`);
    } else if (error.message.includes("WithdrawalNotReady")) {
      console.error(`Withdrawal is not ready yet. Lido withdrawals typically take 2-5 days.`);
    } else {
      console.error(`Error processing withdrawal: ${error.message}`);
    }
    return false;
  }
}

// Main function to execute a withdrawal
async function main() {
  try {
    // Connect to network and contracts
    const { provider, wallet } = await connectToNetwork();
    const { diamondContract } = await connectToContracts(wallet);
    
    // Check balances and withdrawable amounts
    await checkVaultShares(diamondContract, wallet.address);
    await checkWithdrawableAmount(diamondContract, wallet.address);
    await getUnlockTimes(diamondContract, wallet.address);
    
    // Set withdrawal amount (e.g., 100 USDC with 6 decimals)
    const withdrawAmount = ethers.utils.parseUnits("100", 6);
    
    // Get fee data for gas estimation
    const feeData = await provider.getFeeData();
    
    // Execute withdrawal
    await withdraw(diamondContract, withdrawAmount, wallet.address, wallet.address, feeData);
    
    // If you're checking/processing completed withdrawals from Lido:
    // const minExpectedUSDC = ethers.utils.parseUnits("95", 6); // 95 USDC minimum (5% slippage)
    // await processCompletedWithdrawal(diamondContract, minExpectedUSDC, feeData);
    
  } catch (error) {
    console.error(`Unhandled error: ${error.message}`);
  }
}

// Execute if directly run
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

// Export functions for use in other modules
module.exports = {
  connectToNetwork,
  connectToContracts,
  checkVaultShares,
  checkWithdrawableAmount,
  checkMaxWithdraw,
  getUnlockTimes,
  previewWithdraw,
  withdraw,
  processCompletedWithdrawal,
  main
};