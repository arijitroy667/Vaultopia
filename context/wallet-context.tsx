declare global {
  interface Window {
    ethereum?: any;
  }
}

"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { ethers } from "ethers";

interface WalletContextType {
  isConnected: boolean;
  isAdmin: boolean;
  address: string;
  balance: number;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState(0);

  // Check if MetaMask is installed
  const checkMetaMask = () => {
    if (typeof window.ethereum === "undefined") {
      toast.error("MetaMask not found", {
        description: "Please install MetaMask to connect your wallet.",
      });
      return false;
    }
    return true;
  };

  // Connect to MetaMask
  const connect = async () => {
    if (!checkMetaMask()) return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const userBalance = await provider.getBalance(userAddress);
      const formattedBalance = Number(ethers.formatEther(userBalance));

      setIsConnected(true);
      setAddress(userAddress);
      setBalance(formattedBalance);

      toast.success("Wallet connected", {
        description: `Connected to ${userAddress.substring(0, 6)}...${userAddress.slice(-4)}`,
      });
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      toast.error("Connection failed", {
        description: "Could not connect to MetaMask",
      });
    }
  };

  // Disconnect wallet
  const disconnect = () => {
    setIsConnected(false);
    setAddress("");
    setBalance(0);

    toast.info("Wallet disconnected", {
      description: "Your wallet has been disconnected",
    });
  };

  // Check if the connected address is an admin (replace with actual admin address)
  const isAdmin = address.toLowerCase() === "0x1234567890123456789012345678901234567890".toLowerCase();

  return (
    <WalletContext.Provider value={{ isConnected, isAdmin, address, balance, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
