"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { toast } from "sonner"

interface WalletContextType {
  isConnected: boolean
  isAdmin: boolean
  address: string
  balance: number
  connect: () => Promise<void>
  disconnect: () => void
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false)
  const [address, setAddress] = useState("")
  const [balance, setBalance] = useState(0)

  // Simulate wallet connection
  const connect = async () => {
    try {
      // In a real app, this would connect to MetaMask or WalletConnect
      // For demo purposes, we'll simulate a successful connection
      setIsConnected(true)
      setAddress("0x1234567890123456789012345678901234567890")
      setBalance(5.234)

      toast.success("Wallet connected", {
        description: "Successfully connected to your wallet",
      })
    } catch (error) {
      console.error("Failed to connect wallet:", error)
      toast.error("Connection failed", {
        description: "Failed to connect to your wallet",
      })
    }
  }

  const disconnect = () => {
    setIsConnected(false)
    setAddress("")
    setBalance(0)

    toast.info("Wallet disconnected", {
      description: "Your wallet has been disconnected",
    })
  }

  // Check if the connected address is an admin (for demo purposes)
  const isAdmin = address.toLowerCase() === "0x1234567890123456789012345678901234567890".toLowerCase()

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        isAdmin,
        address,
        balance,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}

