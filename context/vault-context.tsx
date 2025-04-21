"use client"

import { createContext, useContext, useState, useRef, useEffect, useCallback, type ReactNode } from "react"
import { useWallet } from "@/context/wallet-context"
import { toast } from "sonner"
import { ethers } from "ethers"

// ABI snippets for the functions we need
const DIAMOND_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function previewDeposit(uint256 assets) public view returns (uint256)",
  "function queueLargeDeposit() external",
  "function maxDeposit(address receiver) public view returns (uint256)",
  "function balanceOf(address user) external view returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function previewWithdraw(uint256 assets) public view returns (uint256)",
  "function maxWithdraw(address owner) external view returns (uint256)",
  "function getWithdrawableAmount(address user) external view returns (uint256)",
  "function getLockedAmount(address user) external view returns (uint256)",
  "function getUnlockTime(address user) external view returns (uint256[])",
  "event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)"
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

interface Transaction {
  type: "deposit" | "withdraw"
  amount: number
  shares: number
  timestamp: number
  status: "pending" | "completed" | "failed"
  txHash?: string        // Transaction hash for blockchain explorer links
  blockNumber?: number   // Block number for additional context
}

interface VaultData {
  tvl: number
  tvlChange: number
  apy: number
  totalShares: number
  exchangeRate: number
  currentFee: number
  accumulatedFees?: number
  lastDailyUpdate?: number
}

interface VaultContextType {
  vaultData: VaultData
  userShares: number
  transactions: Transaction[]
  isLoading: boolean
  deposit: (amount: number) => Promise<void>
  withdraw: (amount: number) => Promise<void>
  setFee: (fee: number) => Promise<void>
  togglePause: (paused: boolean) => Promise<void>
  refreshVaultData: () => Promise<void>
  setLidoWithdrawalAddress: (address: string) => Promise<void>;
  setWstETHAddress: (address: string) => Promise<void>;
  setReceiverContract: (address: string) => Promise<void>;
  setSwapContract: (address: string) => Promise<void>;
  setFeeCollector: (address: string) => Promise<void>;
  toggleEmergencyShutdown: () => Promise<void>;
  collectAccumulatedFees: () => Promise<void>;
  updateWstETHBalance: (user: string, amount: number) => Promise<void>;
  triggerDailyUpdate: () => Promise<void>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export function VaultProvider({ children }: { children: ReactNode }) {
  const { isConnected, address, provider, signer } = useWallet()
  const [userShares, setUserShares] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [diamondContract, setDiamondContract] = useState<ethers.Contract | null>(null)
  const [usdcContract, setUsdcContract] = useState<ethers.Contract | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const lastRefreshTime = useRef(0)
  
  const loadTransactionHistory = async () => {
    if (!isConnected || !address || !diamondContract || !provider) return;
    
    try {
      setIsLoading(true);
      
      // Define event filters for this specific user
      const depositFilter = diamondContract.filters.Deposit(null, address);
      const withdrawFilter = diamondContract.filters.Withdraw(null, null, address);
      
      // Get the current block
      const currentBlock = await provider.getBlockNumber();
      const blocksPerDay = 7200; // 86400 / 12
      const lookbackDays = 30;
      const startBlock = Math.max(currentBlock - (blocksPerDay * lookbackDays), 0);
      
      // Process in chunks to avoid "maximum block range exceeded" errors
      const MAX_BLOCK_RANGE = 40000; // Using 40k to be safe
      
      // Initialize arrays for collecting events
      const allDepositEvents = [];
      const allWithdrawEvents = [];
      
      // Process block ranges in chunks
      let fromBlock = startBlock;
      
      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE, currentBlock);
        
        console.log(`Querying events from block ${fromBlock} to ${toBlock}`);
        
        try {
          // Fetch events in parallel for this chunk
          const [depositEvents, withdrawEvents] = await Promise.all([
            diamondContract.queryFilter(depositFilter, fromBlock, toBlock),
            diamondContract.queryFilter(withdrawFilter, fromBlock, toBlock)
          ]);
          
          // Add events to our collections
          allDepositEvents.push(...depositEvents);
          allWithdrawEvents.push(...withdrawEvents);
          
          // Move to next chunk
          fromBlock = toBlock + 1;
          
          // If we've processed all blocks, break
          if (toBlock >= currentBlock) break;
        } catch (error) {
          console.error(`Error querying events from ${fromBlock} to ${toBlock}:`, error);
          // If there's an error, try a smaller range
          const reducedRange = Math.floor(MAX_BLOCK_RANGE / 2);
          if (reducedRange < 1000) {
            // If we've reduced too much, give up on this chunk and move on
            fromBlock = toBlock + 1;
          } else {
            // Try again with smaller range
            fromBlock = Math.min(fromBlock + reducedRange, currentBlock);
          }
        }
      }
      
      // Process deposit events
      const depositTransactions = await Promise.all(allDepositEvents.map(async (event) => {
        const block = await event.getBlock();
        const typedEvent = event as ethers.EventLog;
        return {
          type: "deposit",
          amount: Number(ethers.formatUnits(typedEvent.args.assets, 6)), // USDC has 6 decimals
          shares: Number(ethers.formatUnits(typedEvent.args.shares, 18)), // Shares have 18 decimals
          timestamp: block?.timestamp ? block.timestamp * 1000 : Date.now(),
          status: "completed",
          txHash: event.transactionHash
        } as Transaction;
      }));
      
      // Process withdrawal events
      const withdrawTransactions = await Promise.all(allWithdrawEvents.map(async (event) => {
        const block = await event.getBlock();
        const typedEvent = event as ethers.EventLog;
        return {
          type: "withdraw",
          amount: Number(ethers.formatUnits(typedEvent.args.assets, 6)),
          shares: Number(ethers.formatUnits(typedEvent.args.shares, 18)),
          timestamp: block?.timestamp ? block.timestamp * 1000 : Date.now(),
          status: "completed",
          txHash: event.transactionHash
        } as Transaction;
      }));
      
      // Combine and sort all transactions by timestamp (newest first)
      const allTransactions = [...depositTransactions, ...withdrawTransactions]
        .sort((a, b) => b.timestamp - a.timestamp);
      
      // Update transactions state with historical data
      setTransactions(prev => {
        // Keep any pending transactions that might not be on-chain yet
        const pendingTx = prev.filter(tx => tx.status === "pending");
        return [...pendingTx, ...allTransactions];
      });
      
    } catch (error) {
      console.error("Error loading transaction history:", error);
    } finally {
      setIsLoading(false);
    }
  };

const setLidoWithdrawalAddress = async (address: string) => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.setLidoWithdrawalAddress(address);
    await tx.wait();
    toast.success("Lido Withdrawal address updated");
  } catch (error) {
    console.error("Error updating Lido Withdrawal address:", error);
    toast.error("Failed to update Lido Withdrawal address");
    throw error;
  }
};

const setWstETHAddress = async (address: string) => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.setWstETHAddress(address);
    await tx.wait();
    toast.success("wstETH address updated");
  } catch (error) {
    console.error("Error updating wstETH address:", error);
    toast.error("Failed to update wstETH address");
    throw error;
  }
};

const setReceiverContract = async (address: string) => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.setReceiverContract(address);
    await tx.wait();
    toast.success("Receiver contract address updated");
  } catch (error) {
    console.error("Error updating receiver contract:", error);
    toast.error("Failed to update receiver contract");
    throw error;
  }
};

const setSwapContract = async (address: string) => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.setSwapContract(address);
    await tx.wait();
    toast.success("Swap contract address updated");
  } catch (error) {
    console.error("Error updating swap contract:", error);
    toast.error("Failed to update swap contract");
    throw error;
  }
};

const setFeeCollector = async (address: string) => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.setFeeCollector(address);
    await tx.wait();
    toast.success("Fee collector address updated");
  } catch (error) {
    console.error("Error updating fee collector:", error);
    toast.error("Failed to update fee collector");
    throw error;
  }
};

const toggleEmergencyShutdown = async () => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.toggleEmergencyShutdown();
    await tx.wait();
    toast.success("Emergency shutdown status toggled");
  } catch (error) {
    console.error("Error toggling emergency shutdown:", error);
    toast.error("Failed to toggle emergency shutdown");
    throw error;
  }
};

const collectAccumulatedFees = async () => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.collectFees();
    await tx.wait();
    toast.success("Fees collected successfully");
    refreshVaultData();
  } catch (error) {
    console.error("Error collecting fees:", error);
    toast.error("Failed to collect fees");
    throw error;
  }
};

const updateWstETHBalance = async (user: string, amount: number) => {
  if (!diamondContract) return;
  try {
    // Convert to wei with 18 decimals (wstETH standard)
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await diamondContract.updateWstETHBalance(user, amountWei);
    await tx.wait();
    toast.success(`wstETH balance updated for ${user}`);
  } catch (error) {
    console.error("Error updating wstETH balance:", error);
    toast.error("Failed to update wstETH balance");
    throw error;
  }
};

const triggerDailyUpdate = async () => {
  if (!diamondContract) return;
  try {
    const tx = await diamondContract.triggerDailyUpdate();
    await tx.wait();
    toast.success("Daily update completed");
    refreshVaultData();
  } catch (error) {
    console.error("Error triggering daily update:", error);
    toast.error("Failed to trigger daily update");
    throw error;
  }
};
  // Default vault data
  const [vaultData, setVaultData] = useState<VaultData>({
    tvl: 0,
    tvlChange: 0,
    apy: 0,
    totalShares: 0,
    exchangeRate: 1.0,
    currentFee: 2.0,
  })
  
  // Contract addresses from environment variables
  const diamondAddress = process.env.NEXT_PUBLIC_DIAMOND_ADDRESS;
  const usdcAddress = process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS;

  // Initialize contracts when wallet connects
  useEffect(() => {
    if (isConnected && provider && signer) {
      initializeContracts();
    }
  }, [isConnected, provider, signer]);

  useEffect(() => {
    if (isConnected && address && diamondContract) {
      loadTransactionHistory();
    }
  }, [isConnected, address, diamondContract]);
  const initializeContracts = async () => {
    try {
      if (!signer) return;

      if (!diamondAddress || !usdcAddress) {
        console.error("Contract addresses not found in environment variables");
        toast.error("Configuration Error", {
          description: "Contract addresses are not properly configured."
        });
        return;
      }
      
      const diamond = new ethers.Contract(diamondAddress, DIAMOND_ABI, signer);
      const usdc = new ethers.Contract(usdcAddress, USDC_ABI, signer);
      
      setDiamondContract(diamond);
      setUsdcContract(usdc);
      
      // Load initial data
      await refreshVaultData();
    } catch (error) {
      console.error("Failed to initialize contracts:", error);
    }
  };

  // Function to get vault data (TVL, shares, exchange rate)
  const getVaultData = async (contract: ethers.Contract) => {
    const totalAssets = await contract.totalAssets();
    const totalShares = await contract.totalSupply();
    
    // Calculate exchange rate (assets per share)
    // If no shares exist yet, use 1.0 as default exchange rate
    let exchangeRate = 1.0;
    if (ethers.getBigInt(totalShares) > BigInt(0)) {
      exchangeRate = Number(ethers.formatUnits(totalAssets, 6)) / 
                     Number(ethers.formatUnits(totalShares, 18));
    }
    
    return {
      tvl: Number(ethers.formatUnits(totalAssets, 6)),
      totalShares: Number(ethers.formatUnits(totalShares, 18)),
      exchangeRate: exchangeRate
    };
  };

  // Function to get user's shares
  const getUserShares = async (contract: ethers.Contract, userAddress: string) => {
    const shares = await contract.balanceOf(userAddress);
    return Number(ethers.formatUnits(shares, 18)); // Assuming 18 decimals for shares
  };

  // Refresh vault data function (exposed to UI)
  const refreshVaultData = useCallback(async (includeTransactions = false) => {
    if (!diamondContract || !address) return;
    
    // Prevent multiple rapid refreshes (throttling)
    const now = Date.now()
    if (isRefreshing || (now - lastRefreshTime.current < 5000)) {
      return; // Skip if already refreshing or refreshed within last 5 seconds
    }
    
    setIsRefreshing(true)
    setIsLoading(true)
    
    try {
      // Get vault data
      const vaultInfo = await getVaultData(diamondContract);
      
      let accumulatedFees = 0;
    try {
      const feesWei = await diamondContract.getAccumulatedFees();
      accumulatedFees = Number(ethers.formatUnits(feesWei, 6)); // USDC decimals
    } catch (e) {
      console.log("getAccumulatedFees not available:", e);
    }
    
    // Get last daily update timestamp (catch errors if function doesn't exist)
    let lastDailyUpdate = 0;
    try {
      const timestamp = await diamondContract.getLastUpdateTimestamp();
      lastDailyUpdate = Number(timestamp);
    } catch (e) {
      console.log("getLastUpdateTimestamp not available:", e);
    }

      setVaultData(prev => ({
        ...prev,
        tvl: vaultInfo.tvl,
        totalShares: vaultInfo.totalShares,
        exchangeRate: vaultInfo.exchangeRate,
        accumulatedFees,
        lastDailyUpdate,
      }));
      
      // Get user's shares
      const shares = await getUserShares(diamondContract, address);
      setUserShares(shares);
  
      // Only load transaction history when explicitly requested
      // This prevents excessive blockchain queries
      if (includeTransactions) {
        await loadTransactionHistory();
      }
      
      lastRefreshTime.current = Date.now()
    } catch (error) {
      console.error("Failed to refresh vault data:", error);
    } finally {
      setIsRefreshing(false)
      setIsLoading(false)
    }
  }, [diamondContract, address, getVaultData, getUserShares, loadTransactionHistory]);

  // Core function for approval and deposit
  const approveAndDeposit = async (
    diamondContract: ethers.Contract, 
    usdcContract: ethers.Contract,
    amount: number, 
    userAddress: string
  ) => {
    // Convert amount to wei with 6 decimals (USDC)
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    
    // Check USDC balance
    const balance = await usdcContract.balanceOf(userAddress);
    if (ethers.getBigInt(balance) < ethers.getBigInt(amountWei)) {
      throw new Error("Insufficient USDC balance");
    }
    
    // Check max deposit limit
    const maxDepositAmount = await diamondContract.maxDeposit(userAddress);
    if (ethers.getBigInt(maxDepositAmount) < ethers.getBigInt(amountWei)) {
      throw new Error(`Amount exceeds max deposit limit`);
    }
    
    // Check if deposit is large (>10% of vault)
    const totalAssets = await diamondContract.totalAssets();
    const isFirstDeposit = ethers.getBigInt(totalAssets) === BigInt(0);
    const isLargeDeposit = !isFirstDeposit && 
      ethers.getBigInt(amountWei) > ethers.getBigInt(totalAssets) / BigInt(10);
    
    if (isLargeDeposit) {
      try {
        // Try to complete deposit if timelock has passed
        const queueTx = await diamondContract.queueLargeDeposit();
        await queueTx.wait();
        throw new Error("Deposit queued. Please wait 1 hour before depositing.");
      } catch (error: any) {
        // If error is not "DepositAlreadyQueued", rethrow it
        if (!error.message?.includes("DepositAlreadyQueued")) {
          throw error;
        }
        // Otherwise continue with deposit (timelock may have passed)
      }
    }
    
    // Check and approve USDC allowance if needed
    const allowance = await usdcContract.allowance(userAddress, diamondContract.address);
    if (ethers.getBigInt(allowance) < ethers.getBigInt(amountWei)) {
      const approveTx = await usdcContract.approve(diamondContract.address, amountWei);
      await approveTx.wait();
    }
    
    // Get fee data for gas estimation
    const feeData = await provider!.getFeeData();
    
    // Execute deposit
    const tx = await diamondContract.deposit(amountWei, userAddress, {
      gasLimit: BigInt(1000000),
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });
    
    // Wait for transaction confirmation
    const receipt = await tx.wait(1);
    
    // Calculate shares received
    const expectedShares = await diamondContract.previewDeposit(amountWei);
    const sharesReceived = Number(ethers.formatUnits(expectedShares, 18));
    
    return { 
      success: true, 
      txHash: receipt.hash, 
      shares: sharesReceived 
    };
  };

  // Real deposit function that interacts with the blockchain
  const deposit = async (amount: number) => {
    if (!isConnected || !address) throw new Error("Wallet not connected");
    if (!diamondContract || !usdcContract) throw new Error("Contracts not initialized");
    
    try {
      // Show pending toast
      const pendingToast = toast.loading("Processing deposit...");
      
      // Add pending transaction
      const pendingTx: Transaction = {
        type: "deposit",
        amount,
        shares: 0, // Will be updated after transaction
        timestamp: Date.now(),
        status: "pending",
      };
      setTransactions(prev => [pendingTx, ...prev]);
      
      // Execute deposit on blockchain
      const result = await approveAndDeposit(diamondContract, usdcContract, amount, address);
      
      // Update UI state
      setUserShares(prev => prev + result.shares);
      
      // Update transactions
      const completedTx: Transaction = {
        ...pendingTx,
        shares: result.shares,
        status: "completed",
      };
      setTransactions(prev => [
        completedTx,
        ...prev.filter(tx => tx !== pendingTx)
      ]);
      
      // Refresh vault data
      await refreshVaultData();
      
      // Show success toast
      toast.dismiss(pendingToast);
      toast.success("Deposit successful", {
        description: `You have deposited $${amount} and received ${result.shares.toFixed(2)} shares`,
      });
      
    } catch (error: any) {
      console.error("Deposit failed:", error);
      
      // Update failed transaction
      setTransactions(prev => prev.map(tx => 
        tx.status === "pending" && tx.type === "deposit" && tx.amount === amount
          ? { ...tx, status: "failed" }
          : tx
      ));
      
      // Show error toast
      toast.error("Deposit failed", {
        description: error.message || "Transaction failed. Please try again.",
      });
    }
  };

  // Withdraw function - simplify for now
  const withdraw = async (amount: number) => {
    if (!isConnected || !address) throw new Error("Wallet not connected");
    if (!diamondContract) throw new Error("Contracts not initialized");
    
    try {
      // Show pending toast
      const pendingToast = toast.loading("Processing withdrawal...");
      
      // Convert amount to wei (USDC has 6 decimals)
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      
      // Check withdrawal limit
      const withdrawable = await diamondContract.getWithdrawableAmount(address);
      if (ethers.getBigInt(withdrawable) < ethers.getBigInt(amountWei)) {
        throw new Error("Amount exceeds withdrawable limit");
      }
      
      // Calculate shares to be burned
      const sharesToBurn = await diamondContract.previewWithdraw(amountWei);
      
      // Add pending transaction
      const pendingTx: Transaction = {
        type: "withdraw",
        amount,
        shares: Number(ethers.formatUnits(sharesToBurn, 18)),
        timestamp: Date.now(),
        status: "pending",
      };
      setTransactions(prev => [pendingTx, ...prev]);
      
      // Get fee data for gas optimization
      const feeData = await provider!.getFeeData();
      
      // Execute withdrawal
      const tx = await diamondContract.withdraw(amountWei, address, address, {
        gasLimit: BigInt(1000000),
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      });
      
      // Wait for transaction confirmation
      const receipt = await tx.wait(1);
      
      // Update UI state with burned shares
      setUserShares(prev => prev - Number(ethers.formatUnits(sharesToBurn, 18)));
      
      // Update transactions
      const completedTx: Transaction = {
        ...pendingTx,
        status: "completed",
      };
      setTransactions(prev => [
        completedTx,
        ...prev.filter(tx => tx !== pendingTx)
      ]);
      
      // Refresh vault data
      await refreshVaultData();
      
      // Show success toast
      toast.dismiss(pendingToast);
      toast.success("Withdrawal successful", {
        description: `You have withdrawn $${amount} by burning ${Number(ethers.formatUnits(sharesToBurn, 18)).toFixed(6)} shares`,
      });
      
    } catch (error: any) {
      console.error("Withdrawal failed:", error);
      
      // Update failed transaction
      setTransactions(prev => prev.map(tx => 
        tx.status === "pending" && tx.type === "withdraw" && tx.amount === amount
          ? { ...tx, status: "failed" }
          : tx
      ));
      
      // Show error toast
      let errorMessage = "Unknown error occurred";
      
      if (error.message) {
        if (error.message.includes("Amount exceeds unlocked balance")) {
          errorMessage = "You're trying to withdraw locked funds. Check unlock times.";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient ETH for gas fees";
        } else {
          errorMessage = error.message;
        }
      }
      
      toast.error("Withdrawal failed", { description: errorMessage });
    }
  };

  // Admin function to set fee
  const setFee = async (fee: number) => {
    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate blockchain delay

    setVaultData((prev) => ({
      ...prev,
      currentFee: fee,
    }));

    toast.success("Fee updated", {
      description: `Performance fee has been set to ${fee}%`,
    });
  };

  // Admin function to toggle pause
  const togglePause = async (paused: boolean) => {
    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate blockchain delay

    if (paused) {
      toast.error("Vault paused", {
        description: "All deposits and withdrawals are now paused",
      });
    } else {
      toast.success("Vault resumed", {
        description: "The vault is now active again",
      });
    }
  };



  return (
    <VaultContext.Provider
      value={{
        vaultData,
        userShares,
        transactions,
        isLoading,
        deposit,
        withdraw,
        setFee,
        togglePause,
        refreshVaultData,
        setLidoWithdrawalAddress,
      setWstETHAddress,
      setReceiverContract,
      setSwapContract,
      setFeeCollector,
      toggleEmergencyShutdown,
      collectAccumulatedFees,
      updateWstETHBalance,
      triggerDailyUpdate
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (context === undefined) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
}