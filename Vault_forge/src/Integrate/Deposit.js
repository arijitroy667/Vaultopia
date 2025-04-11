require('dotenv').config({ path: '../.env' });
const ethers = require('ethers');

// ABI snippets for the functions we need
const DIAMOND_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function previewDeposit(uint256 assets) public view returns (uint256)",
  "function queueLargeDeposit() external",
  "function maxDeposit(address receiver) public view returns (uint256)",
  "function balanceOf(address user) external view returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)"
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

// Connect to the network
async function connectToNetwork() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Connected with address: ${wallet.address}`);
  return { provider, wallet };
}

// Connect to contracts
async function connectToContracts(wallet) {
  const diamondAddress = process.env.DEPOSIT_ADDRESS;
  const usdcAddress = process.env.USDC_CONTRACT_ADDRESS;
  
  const diamondContract = new ethers.Contract(diamondAddress, DIAMOND_ABI, wallet);
  const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
  
  console.log(`Connected to Diamond at: ${diamondAddress}`);
  console.log(`Connected to USDC at: ${usdcAddress}`);
  
  return { diamondContract, usdcContract };
}

// Check USDC balance
async function checkUSDCBalance(usdcContract, address) {
  const balance = await usdcContract.balanceOf(address);
  const decimals = await usdcContract.decimals();
  const formattedBalance = ethers.utils.formatUnits(balance, decimals);
  console.log(`USDC Balance: ${formattedBalance} USDC`);
  return balance;
}

// Check vault balance
async function checkVaultBalance(diamondContract, address) {
  const shares = await diamondContract.balanceOf(address);
  const assets = await diamondContract.convertToShares(shares);
  console.log(`Vault Balance: ${ethers.utils.formatUnits(shares)} shares (${ethers.utils.formatUnits(assets, 6)} USDC equivalent)`);
  return { shares, assets };
}

// Check max deposit
async function checkMaxDeposit(diamondContract, address) {
  const maxDeposit = await diamondContract.maxDeposit(address);
  console.log(`Max Deposit: ${ethers.utils.formatUnits(maxDeposit, 6)} USDC`);
  return maxDeposit;
}

// Approve USDC for spending
async function approveUSDC(usdcContract, spender, amount) {
  console.log(`Approving ${ethers.utils.formatUnits(amount, 6)} USDC for spending...`);
  
  // Check existing allowance first
  const currentAllowance = await usdcContract.allowance(await usdcContract.signer.getAddress(), spender);
  
  if (currentAllowance.gte(amount)) {
    console.log(`Already approved enough USDC.`);
    return true;
  }
  
  try {
    const tx = await usdcContract.approve(spender, amount);
    console.log(`Approval transaction sent: ${tx.hash}`);
    await tx.wait();
    console.log(`Approval confirmed!`);
    return true;
  } catch (error) {
    console.error(`Error approving USDC: ${error.message}`);
    return false;
  }
}

// Queue a large deposit if needed
async function queueLargeDeposit(diamondContract, totalAssets, depositAmount) {
  // Check if deposit is large (>10% of total assets)
  const largeDepositThreshold = totalAssets.div(10);
  
  if (depositAmount.gt(largeDepositThreshold)) {
    console.log(`Large deposit detected (>10% of vault). Queueing timelock...`);
    try {
      const tx = await diamondContract.queueLargeDeposit();
      console.log(`Queue transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log(`Large deposit queued. Please wait 1 hour before depositing.`);
      return true;
    } catch (error) {
      if (error.message.includes("DepositAlreadyQueued")) {
        console.log(`Deposit already queued. Waiting period may still be active.`);
      } else {
        console.error(`Error queueing deposit: ${error.message}`);
      }
      return false;
    }
  }
  
  return false;
}

// Deposit USDC to vault
async function deposit(diamondContract, usdcContract, amount, receiver) {
  console.log(`Initiating deposit of ${ethers.utils.formatUnits(amount, 6)} USDC...`);
  
  // Check if we have enough USDC
  const usdcBalance = await checkUSDCBalance(usdcContract, await usdcContract.signer.getAddress());
  if (usdcBalance.lt(amount)) {
    console.error(`Insufficient USDC balance.`);
    return false;
  }
  
  // Check max deposit limit
  const maxDepositAmount = await checkMaxDeposit(diamondContract, receiver);
  if (maxDepositAmount.lt(amount)) {
    console.error(`Amount exceeds max deposit limit. Maximum: ${ethers.utils.formatUnits(maxDepositAmount, 6)} USDC`);
    return false;
  }
  
  // Check if large deposit needs to be queued
  const totalAssets = await diamondContract.totalAssets();
  const needsQueue = await queueLargeDeposit(diamondContract, totalAssets, amount);
  if (needsQueue) {
    console.log(`Please run this script again after the 1 hour timelock period.`);
    return false;
  }
  
  // Approve USDC spending
  const approved = await approveUSDC(usdcContract, diamondContract.address, amount);
  if (!approved) {
    console.error(`Failed to approve USDC.`);
    return false;
  }
  
  // Preview shares to be received
  const expectedShares = await diamondContract.previewDeposit(amount);
  console.log(`Expected shares from deposit: ${ethers.utils.formatUnits(expectedShares)}`);
  
  // Execute deposit
  try {
    console.log(`Executing deposit...`);
    const tx = await diamondContract.deposit(amount, receiver, {
      gasLimit: 1000000 // Higher gas limit for complex operations
    });
    console.log(`Deposit transaction sent: ${tx.hash}`);
    await tx.wait();
    console.log(`Deposit successful!`);
    
    // Check updated balances
    await checkUSDCBalance(usdcContract, await usdcContract.signer.getAddress());
    await checkVaultBalance(diamondContract, receiver);
    
    return true;
  } catch (error) {
    console.error(`Error during deposit: ${error.message}`);
    return false;
  }
}

// Main function to execute a deposit
async function main() {
  try {
    const { wallet } = await connectToNetwork();
    const { diamondContract, usdcContract } = await connectToContracts(wallet);
    
    // Set deposit amount (e.g., 100 USDC with 6 decimals)
    const depositAmount = ethers.utils.parseUnits("100", 6);
    
    // Check initial balances
    await checkUSDCBalance(usdcContract, wallet.address);
    await checkVaultBalance(diamondContract, wallet.address);
    
    // Execute deposit
    await deposit(diamondContract, usdcContract, depositAmount, wallet.address);
    
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
  checkUSDCBalance,
  checkVaultBalance,
  checkMaxDeposit,
  approveUSDC,
  queueLargeDeposit,
  deposit,
  main
};