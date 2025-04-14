// src/services/depositService.ts
import { ethers } from 'ethers';

// ABI snippets for the functions we need
const DIAMOND_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function previewDeposit(uint256 assets) public view returns (uint256)",
  "function queueLargeDeposit() external",
  "function maxDeposit(address receiver) public view returns (uint256)",
  "function balanceOf(address user) external view returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function totalShares() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)"
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

// Adapt Deposit.js functions for browser use
export async function connectToContracts(provider: ethers.BrowserProvider) {
  const signer = await provider.getSigner();
  const diamondAddress = "0x6b28EFbaF76cDd7F941Ae16F8FC345396bdeea42";
  const usdcAddress = "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8";
  
  if (!diamondAddress || !usdcAddress) {
    throw new Error("Contract addresses not found in environment variables");
  }
  
  const diamondContract = new ethers.Contract(diamondAddress, DIAMOND_ABI, signer);
  const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
  
  return { diamondContract, usdcContract };
}

// depositService.ts - Updated getVaultData function
export async function getVaultData(diamondContract: ethers.Contract) {
  try {
    // Get raw values
    const totalAssetsRaw = await diamondContract.totalAssets();
    const totalSharesRaw = await diamondContract.totalShares();
    
    console.log("Raw data:", {
      totalAssetsRaw,
      totalSharesRaw,
      assetsType: typeof totalAssetsRaw,
      sharesType: typeof totalSharesRaw
    });
    
    // For ethers v6
    let exchangeRate;
    if (totalSharesRaw === BigInt(0) || totalSharesRaw === BigInt(0)) {
      exchangeRate = BigInt(1_000_000); // Equivalent to 1.0 with 6 decimals
    } else {
      // Make sure we're working with BigInts
      const totalAssets = BigInt(totalAssetsRaw.toString());
      const totalShares = BigInt(totalSharesRaw.toString());
      exchangeRate = (totalAssets * BigInt(1_000_000)) / totalShares;
    }
    
    return {
      tvl: Number(totalAssetsRaw) / 1_000_000, // Assuming 6 decimals
      totalShares: Number(totalSharesRaw),
      exchangeRate: Number(exchangeRate) / 1_000_000, // Convert to decimal
    };
  } catch (error) {
    console.error("Error fetching vault data:", error);
    return {
      tvl: 0,
      totalShares: 0,
      exchangeRate: 1.0,
    };
  }
}

export async function getUserShares(diamondContract: ethers.Contract, address: string) {
  const shares = await diamondContract.balanceOf(address);
  return parseFloat(ethers.formatUnits(shares));
}

export async function checkUSDCBalance(usdcContract: ethers.Contract, address: string) {
  const balance = await usdcContract.balanceOf(address);
  const decimals = await usdcContract.decimals();
  return parseFloat(ethers.formatUnits(balance, decimals));
}

export async function approveAndDeposit(
  diamondContract: ethers.Contract,
  usdcContract: ethers.Contract,
  amount: number,
  receiver: string
) {
  // Parse amount based on USDC decimals
  const decimals = await usdcContract.decimals();
  const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
  
  // Check if we need to queue a large deposit
  const totalAssets = await diamondContract.totalAssets();
  const largeDepositThreshold = totalAssets/ BigInt(10);
  
  if (parsedAmount > largeDepositThreshold) {
    try {
      const tx = await diamondContract.queueLargeDeposit();
      await tx.wait();
      throw new Error("Large deposit queued. Please try again in 1 hour.");
    } catch (error: any) {
      if (!error.message.includes("DepositAlreadyQueued")) {
        throw error;
      }
    }
  }
  
  // Approve USDC spending
  const tx1 = await usdcContract.approve(diamondContract.address, parsedAmount);
  await tx1.wait();
  
  // Execute deposit
  const tx2 = await diamondContract.deposit(parsedAmount, receiver, {
    gasLimit: 1000000 // Higher gas limit for complex operations
  });
  
  const receipt = await tx2.wait();
  
  // Parse logs to get shares minted
  const shares = await diamondContract.balanceOf(receiver);
  
  return {
    transactionHash: tx2.hash,
    shares: parseFloat(ethers.formatUnits(shares))
  };
}