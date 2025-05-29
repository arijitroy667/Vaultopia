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
    const provider = new ethers.JsonRpcProvider("https://shy-sly-paper.ethereum-hoodi.quiknode.pro/9d08f68df2e209e40d019a2eea5194b64fcf0d1a");
    
    // Connect wallet
    const privateKey = "";
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Connected to wallet: ${wallet.address}`);
    
    // Contract addresses
    const swapContractAddress = "0xD31E06B76C3bc37cc0C0328835881096Ee8E51ad"; // Replace with your deployed contract
    const usdcAddress = "0x1904f0522FC7f10517175Bd0E546430f1CF0B9Fa";
    
    // Connect to contracts
    const swapContract = new ethers.Contract(swapContractAddress, SWAP_ABI, wallet);
    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
    
    // Get USDC decimals
    const decimals = await usdcContract.decimals();
    console.log(`USDC has ${decimals} decimals`);
    
    // Set deposit amounts
    const usdcAmountToDeposit = ethers.parseUnits("5000", decimals); // 5000 USDC
    const ethAmountToDeposit = ethers.parseEther("2"); // 3ETH
    
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
