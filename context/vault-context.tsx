"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useWallet } from "@/context/wallet-context"
import { toast } from "sonner"

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
  const { isConnected, address } = useWallet()
  const [userShares, setUserShares] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])

  // Mock vault data
  const [vaultData, setVaultData] = useState<VaultData>({
    tvl: 1250000,
    tvlChange: 5.2,
    apy: 8.4,
    totalShares: 1000000,
    exchangeRate: 1.25,
    currentFee: 2.0,
  })

  // Load user data when wallet is connected
  useEffect(() => {
    if (isConnected) {
      // In a real app, this would fetch data from the blockchain
      setUserShares(1000)
      setTransactions([
        {
          type: "deposit",
          amount: 1000,
          shares: 800,
          timestamp: Date.now() - 86400000 * 2, // 2 days ago
          status: "completed",
        },
        {
          type: "deposit",
          amount: 500,
          shares: 400,
          timestamp: Date.now() - 86400000, // 1 day ago
          status: "completed",
        },
        {
          type: "withdraw",
          amount: 250,
          shares: 200,
          timestamp: Date.now() - 3600000, // 1 hour ago
          status: "completed",
        },
      ])
    } else {
      setUserShares(0)
      setTransactions([])
    }
  }, [isConnected])

  // Simulate depositing funds
  const deposit = async (amount: number) => {
    if (!isConnected) throw new Error("Wallet not connected")

    // Calculate shares based on exchange rate
    const shares = amount / vaultData.exchangeRate

    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 2000)) // Simulate blockchain delay

    // Update state
    setUserShares((prev) => prev + shares)
    setVaultData((prev) => ({
      ...prev,
      tvl: prev.tvl + amount,
      totalShares: prev.totalShares + shares,
    }))

    // Add transaction
    const newTransaction: Transaction = {
      type: "deposit",
      amount,
      shares,
      timestamp: Date.now(),
      status: "completed",
    }
    setTransactions((prev) => [newTransaction, ...prev])

    toast.success("Deposit successful", {
      description: `You have deposited $${amount} and received ${shares.toFixed(2)} shares`,
    })
  }

  // Simulate withdrawing funds
  const withdraw = async (shares: number) => {
    if (!isConnected) throw new Error("Wallet not connected")
    if (shares > userShares) throw new Error("Insufficient shares")

    // Calculate amount based on exchange rate
    const amount = shares * vaultData.exchangeRate

    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 2000)) // Simulate blockchain delay

    // Update state
    setUserShares((prev) => prev - shares)
    setVaultData((prev) => ({
      ...prev,
      tvl: prev.tvl - amount,
      totalShares: prev.totalShares - shares,
    }))

    // Add transaction
    const newTransaction: Transaction = {
      type: "withdraw",
      amount,
      shares,
      timestamp: Date.now(),
      status: "completed",
    }
    setTransactions((prev) => [newTransaction, ...prev])

    toast.success("Withdrawal successful", {
      description: `You have withdrawn $${amount.toFixed(2)} by burning ${shares} shares`,
    })
  }

  // Admin function to set fee
  const setFee = async (fee: number) => {
    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate blockchain delay

    setVaultData((prev) => ({
      ...prev,
      currentFee: fee,
    }))

    toast.success("Fee updated", {
      description: `Performance fee has been set to ${fee}%`,
    })
  }

  // Admin function to toggle pause
  const togglePause = async (paused: boolean) => {
    // In a real app, this would call the smart contract
    await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate blockchain delay

    if (paused) {
      toast.error("Vault paused", {
        description: "All deposits and withdrawals are now paused",
      })
    } else {
      toast.success("Vault resumed", {
        description: "The vault is now active again",
      })
    }
  }

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

