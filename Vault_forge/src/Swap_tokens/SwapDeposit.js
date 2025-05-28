import { ethers } from "ethers";

// ABI definitions
const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const SWAP_ABI = [
  "function depositETH() public payable",
  "function depositUSDC(uint256 amount) external",
  "function USDC() view returns (address)",
  "event USDCDeposited(address indexed user, uint amount)",
  "event ETHDeposited(address indexed user, uint amount)"
];

async function main() {
  try {
    // Connect to provider (using Holesky testnet)
    const provider = new ethers.JsonRpcProvider("https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs");
    
    // Connect wallet
    const privateKey = "144b73c3645e2cc6522c3e090e3892afc693133cae399c271af91fde7332d6e4";
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Connected to wallet: ${wallet.address}`);
    
    // Contract addresses
    const swapContractAddress = "0x5C7cda1d0784d0D662E772A2a5450EA48fd687e2"; // Replace with your deployed contract
    const usdcAddress = "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8";
    
    // Connect to contracts
    const swapContract = new ethers.Contract(swapContractAddress, SWAP_ABI, wallet);
    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
    
    // Get USDC decimals
    const decimals = await usdcContract.decimals();
    console.log(`USDC has ${decimals} decimals`);
    
    // Set deposit amounts
    const usdcAmountToDeposit = ethers.parseUnits("1000", decimals); // 1000 USDC
    const ethAmountToDeposit = ethers.parseEther("1"); // 3ETH
    
    // PART 1: USDC DEPOSIT
    
    // Check USDC balance first
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, decimals)} USDC`);
    
    if (usdcBalance < usdcAmountToDeposit) {
      console.log(`Insufficient USDC balance. Need ${ethers.formatUnits(usdcAmountToDeposit, decimals)} USDC`);
    } else {
      // Check current allowance
      const currentAllowance = await usdcContract.allowance(wallet.address, swapContractAddress);
      console.log(`Current USDC allowance: ${ethers.formatUnits(currentAllowance, decimals)} USDC`);
      
      // Approve USDC if needed
      if (currentAllowance < usdcAmountToDeposit) {
        console.log(`Approving ${ethers.formatUnits(usdcAmountToDeposit, decimals)} USDC...`);
        const approveTx = await usdcContract.approve(swapContractAddress, usdcAmountToDeposit);
        await approveTx.wait();
        console.log(`Approval transaction confirmed: ${approveTx.hash}`);
      } else {
        console.log("Sufficient allowance already exists");
      }
      
      // Deposit USDC
      console.log(`Depositing ${ethers.formatUnits(usdcAmountToDeposit, decimals)} USDC...`);
      const depositUsdcTx = await swapContract.depositUSDC(usdcAmountToDeposit);
      await depositUsdcTx.wait();
      console.log(`USDC deposit transaction confirmed: ${depositUsdcTx.hash}`);
    }
    
    // PART 2: ETH DEPOSIT
    
    // Check ETH balance first
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    if (ethBalance < ethAmountToDeposit) {
      console.log(`Insufficient ETH balance. Need ${ethers.formatEther(ethAmountToDeposit)} ETH`);
    } else {
      // Deposit ETH
      console.log(`Depositing ${ethers.formatEther(ethAmountToDeposit)} ETH...`);
      const depositEthTx = await swapContract.depositETH({
        value: ethAmountToDeposit
      });
      await depositEthTx.wait();
      console.log(`ETH deposit transaction confirmed: ${depositEthTx.hash}`);
    }
    
    console.log("All transactions completed successfully!");
    
  } catch (error) {
    console.error("Error in deposit process:", error);
    if (error.reason) console.error("Error reason:", error.reason);
    if (error.data) console.error("Error data:", error.data);
  }
}

// Run script
main().catch((error) => {
  console.error(error);
  process.exit(1);
});