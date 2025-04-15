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
  "function convertToShares(uint256 assets) external view returns (uint256)",
  "function depositsPaused() external view returns (bool)",
  "function emergencyShutdown() external view returns (bool)",
  "function MIN_DEPOSIT_AMOUNT() external view returns (uint256)"
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

// Helper function to extract error message
function extractErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  
  // Handle standard error messages
  if (typeof error === 'object' && error !== null && 'reason' in error) {
    return (error as { reason: string }).reason;
  }
  
  // Try to parse revert reason from data
  if (typeof error === 'object' && error !== null && 'data' in error) {
    try {
      // This is a simplified approach - in reality parsing custom errors properly requires the ABI
      return `Contract error: ${(error as { data: string }).data}`;
    } catch (e) {
      // Ignore parsing failures
    }
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return (error as { message: string }).message;
  }
  
  return String(error) || "Unknown contract error";
}

// Process contract errors into user-friendly messages
function processContractError(error: unknown): Error {
  let message = "Unknown error";
  
  if (typeof error === 'object' && error !== null && 'message' in error) {
    message = String((error as { message: string }).message);
  } else if (typeof error === 'string') {
    message = error;
  }

  // Identify common custom errors from your contract
  if (message.includes("MinimumDepositNotMet")) {
    return new Error("Minimum deposit amount is 100 USDC");
  } else if (message.includes("ZeroAmount")) {
    return new Error("Amount must be greater than zero");
  } else if (message.includes("DepositsPaused")) {
    return new Error("Deposits are currently paused");
  } else if (message.includes("EmergencyShutdown")) {
    return new Error("Contract is in emergency shutdown mode");
  } else if (message.includes("LargeDepositNotTimelocked")) {
    return new Error("Large deposits require timelock. Please queue your deposit first");
  } else if (message.includes("NoSharesMinted")) {
    return new Error("No shares would be minted from this deposit");
  } else if (message.includes("USDCApprovalFailed")) {
    return new Error("USDC approval failed");
  } else {
    return new Error(message);
  }
}

export async function approveAndDeposit(
  diamondContract: ethers.Contract,
  usdcContract: ethers.Contract,
  amount: number,
  receiver: string
) {
  try {
    // Log useful debug info
    console.log("Starting deposit process:", { amount, receiver });

    // Check USDC balance first
    const userBalance = await usdcContract.balanceOf(receiver);
    const decimals = await usdcContract.decimals();
    const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
    
    console.log("Balance check:", {
      userBalance: userBalance.toString(),
      parsedAmount: parsedAmount.toString(),
      hasEnoughBalance: userBalance >= parsedAmount
    });

    if (userBalance < parsedAmount) {
      throw new Error(`Insufficient USDC balance. You have ${ethers.formatUnits(userBalance, decimals)} USDC`);
    }

    // Check minimum deposit (100 USDC from contract)
    const minDeposit = ethers.parseUnits("100", decimals);
    if (parsedAmount < minDeposit) {
      throw new Error(`Minimum deposit is 100 USDC. You tried to deposit ${amount} USDC`);
    }

    // Check if deposits are paused - need to add this to your ABI
    try {
      const isPaused = await diamondContract.depositsPaused();
      if (isPaused) {
        throw new Error("Deposits are currently paused");
      }
    } catch (e) {
      console.log("Could not check if deposits are paused:", e);
    }

    // Check for large deposit and handle timelock
    const totalAssets = await diamondContract.totalAssets();
    const largeDepositThreshold = totalAssets / BigInt(10);
    
    console.log("Large deposit check:", { 
      parsedAmount: parsedAmount.toString(),
      threshold: largeDepositThreshold.toString(),
      isLarge: parsedAmount > largeDepositThreshold
    });

    if (parsedAmount > largeDepositThreshold) {
      console.log("Large deposit detected, queueing...");
      try {
        const tx = await diamondContract.queueLargeDeposit();
        const receipt = await tx.wait();
        console.log("Deposit queued:", receipt);
        throw new Error("Large deposit queued. Please try again in 1 hour.");
      } catch (error: any) {
        // Only ignore "already queued" errors
        if (!error.message?.includes("DepositAlreadyQueued")) {
          throw error;
        }
        console.log("Deposit already queued, proceeding");
      }
    }

    // Check allowance first
    const allowance = await usdcContract.allowance(receiver, diamondContract.address);
    console.log("Current allowance:", allowance.toString());
    
    if (allowance < parsedAmount) {
      console.log("Approving USDC spending...");
      const tx1 = await usdcContract.approve(diamondContract.address, parsedAmount);
      await tx1.wait();
      console.log("USDC approved");
    } else {
      console.log("Sufficient allowance already exists");
    }

    // Add gas estimation with try/catch
    let gasEstimate;
    try {
      console.log("Estimating gas...");
      gasEstimate = await diamondContract.deposit.estimateGas(parsedAmount, receiver);
      console.log("Gas estimate:", gasEstimate.toString());
    } catch (error) {
      console.error("Gas estimation failed:", error);
      // Try to extract error reason
      const errorMessage = extractErrorMessage(error);
      throw new Error(`Cannot process deposit: ${errorMessage}`);
    }
    
    // Execute deposit with 20% extra gas as buffer
    const gasLimit = BigInt(Math.floor(Number(gasEstimate) * 1.2));
    console.log("Executing deposit with gas limit:", gasLimit.toString());
    const tx2 = await diamondContract.deposit(parsedAmount, receiver, {
      gasLimit
    });
    
    const receipt = await tx2.wait();
    console.log("Deposit complete:", receipt);
    
    // Get updated shares
    const shares = await diamondContract.balanceOf(receiver);
    
    return {
      transactionHash: receipt?.hash || tx2.hash,
      shares: parseFloat(ethers.formatUnits(shares))
    };
  } catch (error) {
    console.error("Detailed deposit error:", error);
    throw processContractError(error);
  }
}

export async function safeContractCall<T>(
  call: () => Promise<T>,
  fallback: T,
  errorMessage: string
): Promise<T> {
  try {
    const result = await call();
    console.log(`Call succeeded:`, result);
    return result;
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    return fallback;
  }
}