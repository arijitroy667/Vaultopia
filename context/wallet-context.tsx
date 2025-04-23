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
  usdcBalance: number;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);

  const usdcAddress = process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS;
  const USDC_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
  ];
  
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
      const etherprovider = new ethers.BrowserProvider(window.ethereum);
      setProvider(etherprovider);
      const signer = await etherprovider.getSigner();
      setSigner(signer);
      const userAddress = await signer.getAddress();
      const userBalance = await etherprovider.getBalance(userAddress);
      const formattedBalance = Number(ethers.formatEther(userBalance));

      if (usdcAddress) {
        const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
        const usdcDecimals = await usdcContract.decimals();
        const usdcBalanceRaw = await usdcContract.balanceOf(userAddress);
        const formattedUsdcBalance = Number(ethers.formatUnits(usdcBalanceRaw, usdcDecimals));
        setUsdcBalance(formattedUsdcBalance);

        console.log("Raw USDC balance:", usdcBalanceRaw.toString());
        console.log("Formatted USDC balance:", formattedUsdcBalance);
      }

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
    setUsdcBalance(0);
    setProvider(null);
    setSigner(null);

    toast.info("Wallet disconnected", {
      description: "Your wallet has been disconnected",
    });
  };

  // Check if the connected address is an admin (replace with actual admin address)
  const isAdmin = address.toLowerCase() === "0x9aD95Ef94D945B039eD5E8059603119b61271486".toLowerCase();

  return (
    <WalletContext.Provider value={{ isConnected, isAdmin, address, balance,usdcBalance,provider,signer, connect, disconnect }}>
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
