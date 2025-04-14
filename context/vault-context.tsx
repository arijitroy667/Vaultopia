// "use client"

// import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
// import { useWallet } from "@/context/wallet-context"
// import { toast } from "sonner"

// interface Transaction {
//   type: "deposit" | "withdraw"
//   amount: number
//   shares: number
//   timestamp: number
//   status: "pending" | "completed" | "failed"
// }

// interface VaultData {
//   tvl: number
//   tvlChange: number
//   apy: number
//   totalShares: number
//   exchangeRate: number
//   currentFee: number
// }

// interface VaultContextType {
//   vaultData: VaultData
//   userShares: number
//   transactions: Transaction[]
//   deposit: (amount: number) => Promise<void>
//   withdraw: (shares: number) => Promise<void>
//   setFee: (fee: number) => Promise<void>
//   togglePause: (paused: boolean) => Promise<void>
// }

// const VaultContext = createContext<VaultContextType | undefined>(undefined)

// export function VaultProvider({ children }: { children: ReactNode }) {
//   const { isConnected, address } = useWallet()
//   const [userShares, setUserShares] = useState(0)
//   const [transactions, setTransactions] = useState<Transaction[]>([])

//   // Mock vault data
//   const [vaultData, setVaultData] = useState<VaultData>({
//     tvl: 1250000,
//     tvlChange: 5.2,
//     apy: 8.4,
//     totalShares: 1000000,
//     exchangeRate: 1.25,
//     currentFee: 2.0,
//   })

//   // Load user data when wallet is connected
//   useEffect(() => {
//     if (isConnected) {
//       // In a real app, this would fetch data from the blockchain
//       setUserShares(1000)
//       setTransactions([
//         {
//           type: "deposit",
//           amount: 1000,
//           shares: 800,
//           timestamp: Date.now() - 86400000 * 2, // 2 days ago
//           status: "completed",
//         },
//         {
//           type: "deposit",
//           amount: 500,
//           shares: 400,
//           timestamp: Date.now() - 86400000, // 1 day ago
//           status: "completed",
//         },
//         {
//           type: "withdraw",
//           amount: 250,
//           shares: 200,
//           timestamp: Date.now() - 3600000, // 1 hour ago
//           status: "completed",
//         },
//       ])
//     } else {
//       setUserShares(0)
//       setTransactions([])
//     }
//   }, [isConnected])

//   // Simulate depositing funds
//   const deposit = async (amount: number) => {
//     if (!isConnected) throw new Error("Wallet not connected")

//     // Calculate shares based on exchange rate
//     const shares = amount / vaultData.exchangeRate

//     // In a real app, this would call the smart contract
//     await new Promise((resolve) => setTimeout(resolve, 2000)) // Simulate blockchain delay

//     // Update state
//     setUserShares((prev) => prev + shares)
//     setVaultData((prev) => ({
//       ...prev,
//       tvl: prev.tvl + amount,
//       totalShares: prev.totalShares + shares,
//     }))

//     // Add transaction
//     const newTransaction: Transaction = {
//       type: "deposit",
//       amount,
//       shares,
//       timestamp: Date.now(),
//       status: "completed",
//     }
//     setTransactions((prev) => [newTransaction, ...prev])

//     toast.success("Deposit successful", {
//       description: `You have deposited $${amount} and received ${shares.toFixed(2)} shares`,
//     })
//   }

//   // Simulate withdrawing funds
//   const withdraw = async (shares: number) => {
//     if (!isConnected) throw new Error("Wallet not connected")
//     if (shares > userShares) throw new Error("Insufficient shares")

//     // Calculate amount based on exchange rate
//     const amount = shares * vaultData.exchangeRate

//     // In a real app, this would call the smart contract
//     await new Promise((resolve) => setTimeout(resolve, 2000)) // Simulate blockchain delay

//     // Update state
//     setUserShares((prev) => prev - shares)
//     setVaultData((prev) => ({
//       ...prev,
//       tvl: prev.tvl - amount,
//       totalShares: prev.totalShares - shares,
//     }))

//     // Add transaction
//     const newTransaction: Transaction = {
//       type: "withdraw",
//       amount,
//       shares,
//       timestamp: Date.now(),
//       status: "completed",
//     }
//     setTransactions((prev) => [newTransaction, ...prev])

//     toast.success("Withdrawal successful", {
//       description: `You have withdrawn $${amount.toFixed(2)} by burning ${shares} shares`,
//     })
//   }

//   // Admin function to set fee
//   const setFee = async (fee: number) => {
//     // In a real app, this would call the smart contract
//     await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate blockchain delay

//     setVaultData((prev) => ({
//       ...prev,
//       currentFee: fee,
//     }))

//     toast.success("Fee updated", {
//       description: `Performance fee has been set to ${fee}%`,
//     })
//   }

//   // Admin function to toggle pause
//   const togglePause = async (paused: boolean) => {
//     // In a real app, this would call the smart contract
//     await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate blockchain delay

//     if (paused) {
//       toast.error("Vault paused", {
//         description: "All deposits and withdrawals are now paused",
//       })
//     } else {
//       toast.success("Vault resumed", {
//         description: "The vault is now active again",
//       })
//     }
//   }

//   return (
//     <VaultContext.Provider
//       value={{
//         vaultData,
//         userShares,
//         transactions,
//         deposit,
//         withdraw,
//         setFee,
//         togglePause,
//       }}
//     >
//       {children}
//     </VaultContext.Provider>
//   )
// }

// export function useVault() {
//   const context = useContext(VaultContext)
//   if (context === undefined) {
//     throw new Error("useVault must be used within a VaultProvider")
//   }
//   return context
// }

// context/vault-context.tsx
"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useWallet } from "@/context/wallet-context"
import { toast } from "sonner"
import { ethers } from "ethers"
import { 
  connectToContracts, 
  getVaultData, 
  getUserShares, 
  approveAndDeposit 
} from "@/services/depositService"

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
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export function VaultProvider({ children }: { children: ReactNode }) {
  const { isConnected, address, provider } = useWallet()
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

  // Initialize contracts when wallet connects
  useEffect(() => {
    if (isConnected && provider) {
      initializeContracts();
    }
  }, [isConnected, provider]);

  const initializeContracts = async () => {
    try {
      const { diamondContract: diamond, usdcContract: usdc } = await connectToContracts(provider!);
      setDiamondContract(diamond);
      setUsdcContract(usdc);
      
      // Load initial data
      await loadVaultData(diamond);
      
      if (address) {
        await loadUserData(diamond, address);
      }
    } catch (error) {
      console.error("Failed to initialize contracts:", error);
    }
  };

  const loadVaultData = async (contract: ethers.Contract) => {
    try {
      const vaultInfo = await getVaultData(contract);
      
      setVaultData({
        tvl: vaultInfo.tvl,
        tvlChange: 0, // Can be calculated if historical data is available
        apy: 8.4, // This would need to come from another source
        totalShares: vaultInfo.totalShares,
        exchangeRate: vaultInfo.exchangeRate,
        currentFee: 2.0, // This would need to be fetched from the contract
      });
    } catch (error) {
      console.error("Failed to load vault data:", error);
    }
  };

  const loadUserData = async (contract: ethers.Contract, userAddress: string) => {
    try {
      const shares = await getUserShares(contract, userAddress);
      setUserShares(shares);
      
      // Load user transactions from contract events (simplified for this example)
      // In a real app, you'd query blockchain events for user transactions
    } catch (error) {
      console.error("Failed to load user data:", error);
    }
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
      await loadVaultData(diamondContract);
      
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

  // The rest of your functions would be implemented similarly
  // Replace the mock implementations with actual blockchain calls

  const withdraw = async (shares: number) => {
    // Similar implementation to deposit but for withdrawals
    // ...
  };

  const setFee = async (fee: number) => {
    // Implementation for admin to set fee
    // ...
  };

  const togglePause = async (paused: boolean) => {
    // Implementation for admin to toggle pause
    // ...
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
      }}
    >
      {children}
    </VaultContext.Provider>
  )
}

export function useVault() {
  const context = useContext(VaultContext)
  if (context === undefined) {
    throw new Error("useVault must be used within a VaultProvider")
  }
  return context
}