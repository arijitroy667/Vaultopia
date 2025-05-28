"use client";

declare global {
  interface Window {
    ethereum?: any;
  }
}

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
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

  const usdcAddress = "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8";
  const USDC_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
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
      await window.ethereum.request({ method: "eth_requestAccounts" });
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
        const formattedUsdcBalance = Number(
          ethers.formatUnits(usdcBalanceRaw, usdcDecimals)
        );
        setUsdcBalance(formattedUsdcBalance);

        console.log("Raw USDC balance:", usdcBalanceRaw.toString());
        console.log("Formatted USDC balance:", formattedUsdcBalance);
      }

      setIsConnected(true);
      setAddress(userAddress);
      setBalance(formattedBalance);

      toast.success("Wallet connected", {
        description: `Connected to ${userAddress.substring(
          0,
          6
        )}...${userAddress.slice(-4)}`,
      });
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      toast.error("Connection failed", {
        description: "Could not connect to MetaMask",
      });
    }
  };

  // Add these to the WalletProvider component
  useEffect(() => {
    // Check if already connected from previous session
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          // Try to get accounts, which will prompt if not already authorized
          const accounts = await window.ethereum.request({
            method: "eth_accounts", // This doesn't prompt, just checks existing permissions
          });

          if (accounts && accounts.length > 0) {
            // User has previously authorized this site
            connect();
          }
        } catch (error) {
          console.log("Not connected to MetaMask");
        }
      }
    };

    checkConnection();

    // Add event listeners for MetaMask events
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length === 0) {
          // User disconnected their wallet
          disconnect();
        } else {
          // User switched accounts, reconnect
          connect();
        }
      });

      window.ethereum.on("chainChanged", () => {
        // Network changed, refresh the page
        window.location.reload();
      });
    }

    // Cleanup event listeners
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener("accountsChanged", () => {});
        window.ethereum.removeListener("chainChanged", () => {});
      }
    };
  }, []);

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
  const adminAddress = "0xaBb39905aE12EfC057a9381A63e9A372BCCc53C1";
  const isAdmin = address.toLowerCase() === adminAddress.toLowerCase();

  const contextValue = useMemo(
    () => ({
      isConnected,
      isAdmin,
      address,
      balance,
      usdcBalance,
      provider,
      signer,
      connect,
      disconnect,
    }),
    [isConnected, isAdmin, address, balance, usdcBalance, provider, signer]
  );

  return (
    <WalletContext.Provider value={contextValue}>
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
