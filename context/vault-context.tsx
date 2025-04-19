"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
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
  "function convertToShares(uint256 assets) external view returns (uint256)"
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
}

interface VaultData {
  tvl: number
  tvlChange: number
  apy: number
  totalShares: number
  exchangeRate: number
  currentFee: number
}

interface VaultContextType {
  vaultData: VaultData
  userShares: number
  transactions: Transaction[]
  deposit: (amount: number) => Promise<void>
  withdraw: (shares: number) => Promise<void>
  setFee: (fee: number) => Promise<void>
  togglePause: (paused: boolean) => Promise<void>
  refreshVaultData: () => Promise<void>
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export function VaultProvider({ children }: { children: ReactNode }) {
  const { isConnected, address, provider, signer } = useWallet()
  const [userShares, setUserShares] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [diamondContract, setDiamondContract] = useState<ethers.Contract | null>(null)
  const [usdcContract, setUsdcContract] = useState<ethers.Contract | null>(null)

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
  const refreshVaultData = async () => {
    if (!diamondContract || !address) return;
    
    try {
      // Get vault data
      const vaultInfo = await getVaultData(diamondContract);
      
      setVaultData(prev => ({
        ...prev,
        tvl: vaultInfo.tvl,
        totalShares: vaultInfo.totalShares,
        exchangeRate: vaultInfo.exchangeRate,
      }));
      
      // Get user's shares
      const shares = await getUserShares(diamondContract, address);
      setUserShares(shares);
      
    } catch (error) {
      console.error("Failed to refresh vault data:", error);
    }
  };

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
  const withdraw = async (shares: number) => {
    if (!isConnected) throw new Error("Wallet not connected");
    if (shares > userShares) throw new Error("Insufficient shares");

    // Calculate amount based on exchange rate
    const amount = shares * vaultData.exchangeRate;

    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate blockchain delay

    // Update state
    setUserShares((prev) => prev - shares);
    setVaultData((prev) => ({
      ...prev,
      tvl: prev.tvl - amount,
      totalShares: prev.totalShares - shares,
    }));

    // Add transaction
    const newTransaction: Transaction = {
      type: "withdraw",
      amount,
      shares,
      timestamp: Date.now(),
      status: "completed",
    };
    setTransactions((prev) => [newTransaction, ...prev]);

    toast.success("Withdrawal successful", {
      description: `You have withdrawn $${amount.toFixed(2)} by burning ${shares} shares`,
    });
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
        deposit,
        withdraw,
        setFee,
        togglePause,
        refreshVaultData
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