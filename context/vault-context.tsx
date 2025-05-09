"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useWallet } from "@/context/wallet-context";
import { toast } from "sonner";
import { ethers } from "ethers";

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
  "function swapContract() external view returns (address)",
  "function receiverContract() external view returns (address)",
  "function wstETHAddress() external view returns (address)",
  "function lidoWithdrawalAddress() external view returns (address)",
  "function emergencyShutdown() external view returns (bool)",
  "function depositsPaused() external view returns (bool)",
  "function accumulatedFees() external view returns (uint256)",
  "function lastDailyUpdate() external view returns (uint256)",
  // Admin functions
  "function setPerformanceFee(uint256 fee) external",
  "function setDepositsPaused(bool paused) external",
  "function collectFees() external",
  "function toggleEmergencyShutdown() external",
  "function setLidoWithdrawalAddress(address) external",
  "function setWstETHAddress(address) external",
  "function setReceiverContract(address) external",
  "function setSwapContract(address) external",
  "function setFeeCollector(address) external",
  "function updateWstETHBalance(address user, uint256 amount) external",
  "function triggerDailyUpdate() external",

  "event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "error ZeroAmount()",
  "error DepositsPaused()",
  "error MinimumDepositNotMet()",
  "error EmergencyShutdown()",
  "error NoSharesMinted()",
  "error LargeDepositNotTimelocked()",
  "error DepositAlreadyQueued()",
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

interface Transaction {
  type: "deposit" | "withdraw";
  amount: number;
  shares: number;
  timestamp: number;
  status: "pending" | "completed" | "failed";
  txHash?: string; // Transaction hash for blockchain explorer links
  blockNumber?: number; // Block number for additional context
}

interface VaultData {
  tvl: number;
  tvlChange: number;
  apy: number;
  totalShares: number;
  exchangeRate: number;
  currentFee: number;
  accumulatedFees?: number;
  lastDailyUpdate?: number;
}

interface VaultContextType {
  vaultData: VaultData;
  userShares: number;
  transactions: Transaction[];
  isLoading: boolean;
  deposit: (amount: number) => Promise<void>;
  withdraw: (amount: number) => Promise<void>;
  setFee: (fee: number) => Promise<void>;
  togglePause: (paused: boolean) => Promise<void>;
  refreshVaultData: (includeTransactions?: boolean) => Promise<void>;
  setLidoWithdrawalAddress: (address: string) => Promise<void>;
  setWstETHAddress: (address: string) => Promise<void>;
  setReceiverContract: (address: string) => Promise<void>;
  setSwapContract: (address: string) => Promise<void>;
  setFeeCollector: (address: string) => Promise<void>;
  toggleEmergencyShutdown: () => Promise<void>;
  collectAccumulatedFees: () => Promise<void>;
  updateWstETHBalance: (user: string, amount: number) => Promise<void>;
  triggerDailyUpdate: () => Promise<void>;
  fetchLidoAPY: () => Promise<number | null>;
}

function debounce<T>(func: (...args: any[]) => Promise<T>, wait: number) {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: any[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const later = () => {
        clearTimeout(timeout);
        func(...args)
          .then(resolve)
          .catch(reject);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    });
  };
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { isConnected, address, provider, signer } = useWallet();
  const [userShares, setUserShares] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [diamondContract, setDiamondContract] =
    useState<ethers.Contract | null>();
  const [usdcContract, setUsdcContract] = useState<ethers.Contract | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastRefreshTime = useRef(0);

  const fetchLidoAPY = useCallback(
    debounce(async () => {
      try {
        console.log("Fetching Lido APY...");
        const response = await fetch(
          "https://eth-api-holesky.testnet.fi/v1/protocol/steth/apr/sma"
        );
        const data = await response.json();

        // Get the SMA APR value (convert from decimal to percentage)
        const aprSMA = data.data.smaApr * 100;

        // Calculate the final APY (add premium, ensure positive)
        const finalAPY = Math.max(parseFloat((aprSMA + 2).toFixed(2)), 0.01);
        console.log("Lido APY fetched successfully:", finalAPY);

        // Update vault data with the new APY
        setVaultData((prev) => ({
          ...prev,
          apy: finalAPY,
        }));

        return finalAPY;
      } catch (error) {
        console.error("Failed to fetch Lido APY:", error);

        // Even on error, ensure we have a fallback APY
        setVaultData((prev) => ({
          ...prev,
          apy: prev.apy || 4.2, // Default fallback APY if we can't fetch
        }));

        return null;
      }
    }, 20000),
    []
  ); // 20 sec debounce

  const loadTransactionHistory = async () => {
    if (!isConnected || !address || !diamondContract || !provider) return;

    try {
      setIsLoading(true);

      // Define event filters for this specific user
      const depositFilter = diamondContract.filters.Deposit(null, address);
      const withdrawFilter = diamondContract.filters.Withdraw(
        null,
        null,
        address
      );

      // Get the current block
      const currentBlock = await provider.getBlockNumber();
      const blocksPerDay = 7200; // 86400 / 12
      const lookbackDays = 30;
      const startBlock = Math.max(
        currentBlock - blocksPerDay * lookbackDays,
        0
      );

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
            diamondContract.queryFilter(withdrawFilter, fromBlock, toBlock),
          ]);

          // Add events to our collections
          allDepositEvents.push(...depositEvents);
          allWithdrawEvents.push(...withdrawEvents);

          // Move to next chunk
          fromBlock = toBlock + 1;

          // If we've processed all blocks, break
          if (toBlock >= currentBlock) break;
        } catch (error) {
          console.error(
            `Error querying events from ${fromBlock} to ${toBlock}:`,
            error
          );
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
      const depositTransactions = await Promise.all(
        allDepositEvents.map(async (event) => {
          const block = await event.getBlock();
          const typedEvent = event as ethers.EventLog;
          return {
            type: "deposit",
            amount: Number(ethers.formatUnits(typedEvent.args.assets, 6)), // USDC has 6 decimals
            shares: Number(ethers.formatUnits(typedEvent.args.shares, 18)), // Shares have 18 decimals
            timestamp: block?.timestamp ? block.timestamp * 1000 : Date.now(),
            status: "completed",
            txHash: event.transactionHash,
          } as Transaction;
        })
      );

      // Process withdrawal events
      const withdrawTransactions = await Promise.all(
        allWithdrawEvents.map(async (event) => {
          const block = await event.getBlock();
          const typedEvent = event as ethers.EventLog;
          return {
            type: "withdraw",
            amount: Number(ethers.formatUnits(typedEvent.args.assets, 6)),
            shares: Number(ethers.formatUnits(typedEvent.args.shares, 18)),
            timestamp: block?.timestamp ? block.timestamp * 1000 : Date.now(),
            status: "completed",
            txHash: event.transactionHash,
          } as Transaction;
        })
      );

      // Combine and sort all transactions by timestamp (newest first)
      const allTransactions = [
        ...depositTransactions,
        ...withdrawTransactions,
      ].sort((a, b) => b.timestamp - a.timestamp);

      // Update transactions state with historical data
      setTransactions((prev) => {
        // Keep any pending transactions that might not be on-chain yet
        const pendingTx = prev.filter((tx) => tx.status === "pending");
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

  const setSwapContract = async (address: string): Promise<void> => {
    if (!diamondContract) return;
    if (!ethers.isAddress(address)) {
      throw new Error("Invalid swap contract address");
    }
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
  });

  const diamondAddress = "0x879Fb6Dd6c64157405845b681184B616c49fB00E";
  const usdcAddress = "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8";

  // Initialize contracts when wallet connects
  useEffect(() => {
    if (isConnected && provider && signer) {
      initializeContracts();
    }
  }, [isConnected, provider, signer]);

  useEffect(() => {
    if (isConnected) {
      // Only fetch if there's no APY value yet or it's been more than 1 hour
      const lastFetchTime = localStorage.getItem("lastApyFetchTime");
      const shouldFetch =
        !vaultData.apy ||
        !lastFetchTime ||
        Date.now() - parseInt(lastFetchTime) > 3600000; // 1 hour

      if (shouldFetch) {
        fetchLidoAPY().then(() => {
          localStorage.setItem("lastApyFetchTime", Date.now().toString());
        });
      }

      // Then fetch every 24 hours (but don't interfere with manual refreshes)
      const dailyUpdateInterval = setInterval(
        fetchLidoAPY,
        24 * 60 * 60 * 1000
      );
      return () => clearInterval(dailyUpdateInterval);
    }
  }, [isConnected, fetchLidoAPY, vaultData.apy]);

  useEffect(() => {
    if (isConnected && address && diamondContract) {
      loadTransactionHistory();
    }
  }, [isConnected, address, diamondContract]);

  const initializeContracts = async () => {
    try {
      if (!signer) {
        console.error("No signer available");
        return;
      }

      if (!diamondAddress || !usdcAddress) {
        console.error(
          "Contract addresses not found in environment variables:",
          {
            diamondAddress,
            usdcAddress,
          }
        );
        toast.error("Configuration Error", {
          description: "Contract addresses are not properly configured.",
        });
        return;
      }

      console.log("Initializing contracts with addresses:", {
        diamondAddress,
        usdcAddress,
      });

      const diamond = new ethers.Contract(diamondAddress, DIAMOND_ABI, signer);
      const usdc = new ethers.Contract(usdcAddress, USDC_ABI, signer);

      if (!ethers.isAddress(diamondAddress)) {
        console.error("Invalid diamond contract address:", diamondAddress);
        toast.error("Contract Error", {
          description: "Invalid diamond contract address format.",
        });
        return;
      }

      if (!ethers.isAddress(usdcAddress)) {
        console.error("Invalid USDC contract address:", usdcAddress);
        toast.error("Contract Error", {
          description: "Invalid USDC contract address format.",
        });
        return;
      }

      console.log("Contracts initialized successfully:", {
        diamondAddress: diamond.target,
        usdcAddress: usdc.target,
      });

      setDiamondContract(diamond);
      setUsdcContract(usdc);

      // Load initial data
      await refreshVaultData();
    } catch (error) {
      console.error("Failed to initialize contracts:", error);
    }
  };

  // Function to get vault data (TVL, shares, exchange rate)
  const getVaultData = useCallback(async (contract: ethers.Contract) => {
    const totalAssets = await contract.totalAssets();
    const totalShares = await contract.totalSupply();

    // Calculate exchange rate (assets per share)
    let exchangeRate = 1.0;
    if (ethers.getBigInt(totalShares) > BigInt(0)) {
      exchangeRate =
        Number(ethers.formatUnits(totalAssets, 6)) /
        Number(ethers.formatUnits(totalShares, 18));
    }

    return {
      tvl: Number(ethers.formatUnits(totalAssets, 6)),
      totalShares: Number(ethers.formatUnits(totalShares, 18)),
      exchangeRate: exchangeRate,
    };
  }, []);

  // Function to get user's shares
  const getUserShares = useCallback(
    async (contract: ethers.Contract, userAddress: string) => {
      const shares = await contract.balanceOf(userAddress);
      return Number(ethers.formatUnits(shares, 18));
    },
    []
  );

  // Refresh vault data function (exposed to UI)
  const refreshVaultData = useCallback(
    async (includeTransactions = false) => {
      if (!diamondContract || !address) return;

      // Prevent multiple rapid refreshes (throttling)
      const now = Date.now();
      if (isRefreshing || now - lastRefreshTime.current < 5000) {
        return; // Skip if already refreshing or refreshed within last 5 seconds
      }

      setIsRefreshing(true);
      setIsLoading(true);

      try {
        // Use Promise.allSettled to run all requests in parallel
        // This ensures one failure doesn't stop other data from loading
        const [
          vaultInfoResult,
          accumulatedFeesResult,
          lastUpdateResult,
          sharesResult,
        ] = await Promise.allSettled([
          getVaultData(diamondContract),
          diamondContract.accumulatedFees(),
          diamondContract.lastDailyUpdate(),
          getUserShares(diamondContract, address),
        ]);

        // Process vault info (TVL, shares, exchange rate)
        let vaultInfo = {
          tvl: 0,
          totalShares: 0,
          exchangeRate: 1.0,
        };
        if (vaultInfoResult.status === "fulfilled") {
          vaultInfo = vaultInfoResult.value;
        } else {
          console.error("Failed to get vault data:", vaultInfoResult.reason);
        }

        // Process accumulated fees
        let accumulatedFees = 0;
        if (accumulatedFeesResult.status === "fulfilled") {
          accumulatedFees = Number(
            ethers.formatUnits(accumulatedFeesResult.value, 6)
          );
        } else {
          console.warn(
            "Failed to get accumulatedFees:",
            accumulatedFeesResult.reason
          );
        }

        // Process last update time
        let lastDailyUpdate = 0;
        if (lastUpdateResult.status === "fulfilled") {
          lastDailyUpdate = Number(lastUpdateResult.value);
        } else {
          console.warn(
            "Failed to get lastDailyUpdate:",
            lastUpdateResult.reason
          );
        }

        // Process user shares
        if (sharesResult.status === "fulfilled") {
          setUserShares(sharesResult.value);
        } else {
          console.warn("Failed to get user shares:", sharesResult.reason);
        }

        // Format the timestamp for easier display
        const formattedLastUpdate =
          lastDailyUpdate > 0
            ? new Date(lastDailyUpdate * 1000).toLocaleString()
            : "Never";

        // Update vault data state
        setVaultData((prev) => ({
          ...prev,
          tvl: vaultInfo.tvl,
          totalShares: vaultInfo.totalShares,
          exchangeRate: vaultInfo.exchangeRate,
          accumulatedFees: accumulatedFees || 0,
          lastDailyUpdate: lastDailyUpdate || 0,
          formattedLastUpdate: formattedLastUpdate,
          apy: prev.apy,
          isStale: Date.now() - lastDailyUpdate * 1000 > 24 * 60 * 60 * 1000, // Flag as stale if > 24 hours
        }));

        // Only load transaction history when explicitly requested
        if (includeTransactions) {
          await loadTransactionHistory();
        }

        lastRefreshTime.current = Date.now();
      } catch (error) {
        console.error("Failed to refresh vault data:", error);
      } finally {
        setIsRefreshing(false);
        setIsLoading(false);
      }
    },
    [
      diamondContract,
      address,
      isRefreshing,
      getVaultData,
      getUserShares,
      loadTransactionHistory,
    ]
  );

  const checkContractConfiguration = async () => {
    if (!diamondContract) return null;

    try {
      // Get addresses
      const swapAddr = "0xdb229c8dDE6A500e0C9A0E031Be17b5A0058e9a1";
      const receiverAddr = "0x5B04671C547f7B3e4D5E5F6Cea1D908872339CcE";
      const wstEthAddr = "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D"; // Default wstETH on Holesky
      const lidoAddr = "0xF0179dEC45a37423EAD4FaD5fCb136197872EAd9"; // Default Lido on Holesky

      console.log("Contract configuration:", {
        swapContract: swapAddr,
        receiverContract: receiverAddr,
        wstETHAddress: wstEthAddr,
        lidoWithdrawalAddress: lidoAddr,
        diamondContract: diamondContract.target,
      });

      // Check if addresses are valid
      const issues = [];
      if (!ethers.isAddress(swapAddr) || swapAddr === ethers.ZeroAddress)
        issues.push("Swap contract not set");
      if (
        !ethers.isAddress(receiverAddr) ||
        receiverAddr === ethers.ZeroAddress
      )
        issues.push("Receiver contract not set");

      return {
        isConfigurationValid: issues.length === 0,
        issues,
      };
    } catch (error) {
      console.error("Configuration check failed:", error);
      return {
        isConfigurationValid: false,
        issues: ["Failed to check configuration"],
      };
    }
  };

  // Core function for approval and deposit with enhanced diagnostics
  const approveAndDeposit = async (
    diamondContract: ethers.Contract,
    usdcContract: ethers.Contract,
    amount: number,
    userAddress: string
  ) => {
    // Convert amount to wei with 6 decimals (USDC)
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const formattedAddress = ethers.getAddress(userAddress);

    // Basic validation
    if (!diamondContract || !usdcContract) {
      throw new Error("Contracts not initialized");
    }

    // Check USDC balance
    const balance = await usdcContract.balanceOf(userAddress);
    if (ethers.getBigInt(balance) < ethers.getBigInt(amountWei)) {
      throw new Error("Insufficient USDC balance");
    }

    // Check and approve USDC allowance if needed
    const allowance = await usdcContract.allowance(
      userAddress,
      diamondContract.target
    );

    console.log("USDC Allowance Check:", {
      currentAllowance: ethers.formatUnits(allowance, 6),
      requiredAmount: ethers.formatUnits(amountWei, 6),
      needsApproval: ethers.getBigInt(allowance) < ethers.getBigInt(amountWei),
    });

    if (ethers.getBigInt(allowance) < ethers.getBigInt(amountWei)) {
      console.log("Approving USDC...");
      const approveTx = await usdcContract.approve(
        diamondContract.target,
        amountWei
      );
      await approveTx.wait();
      console.log("USDC approved successfully");
    }

    console.log("Deposit params:", {
      amountWei: amountWei.toString(),
      formattedAddress,
      amountType: typeof amountWei,
    });

    // Try to estimate gas first to get better error messages
    try {
      console.log("Estimating gas for deposit...");
      await diamondContract.deposit.estimateGas(amountWei, formattedAddress);
      console.log("Gas estimation successful!");
    } catch (error: any) {
      console.error("Gas estimation failed:", error);

      // Try to decode custom errors
      if (error.data) {
        const errorSignatures: Record<string, string> = {
          "0x4f42be3b": "ZeroAmount",
          "0x430a7c8c": "DepositsPaused",
          "0x214e81ea": "MinimumDepositNotMet",
          "0x2a7b344a": "EmergencyShutdown",
          "0x1140334b": "NoSharesMinted",
          "0x8ccd08da": "LargeDepositNotTimelocked",
          "0x7d334ba6": "DepositAlreadyQueued",
          "0x08c379a0": "Error", // Add general Solidity error
          "0x8178553c": "SwapContractNotSet",
          "0x82b42900": "USDCApprovalFailed",
          "0xa02cc8c4": "NoEthReceived",
        };

        // Try to extract error signature (first 4 bytes of the error data)
        const errorSig = error.data.slice(0, 10);
        if (errorSig in errorSignatures) {
          throw new Error(errorSignatures[errorSig]);
        }
      }

      // Alternative deposit attempt with hardcoded gas limit as fallback
      if (amountWei < BigInt("1000000")) {
        // Only try fallback for smaller amounts
        console.log("Attempting fallback deposit with fixed gas limit...");
        try {
          const fallbackGasLimit = 500000; // Hard-coded safe value
          const tx = await diamondContract.deposit(
            amountWei,
            formattedAddress,
            {
              gasLimit: BigInt(fallbackGasLimit),
            }
          );

          console.log("Fallback deposit transaction sent:", tx.hash);
          const receipt = await tx.wait(1);
          console.log("Fallback transaction confirmed:", receipt);

          const expectedShares = await diamondContract.previewDeposit(
            amountWei
          );
          const sharesReceived = Number(ethers.formatUnits(expectedShares, 18));

          return {
            success: true,
            txHash: receipt.hash,
            shares: sharesReceived,
          };
        } catch (fallbackError) {
          console.error("Fallback deposit failed:", fallbackError);
        }
      }

      console.log("Transaction debug info:", {
        userAddress: formattedAddress,
        contractAddress: diamondContract.target,
        amountWei: amountWei.toString(),
        timestamp: new Date().toISOString(),
        error: error.message,
      });

      // Check for common issues
      if (error.message) {
        console.log("Error message:", error.message);

        // Try to provide more specific error messages
        if (error.message?.includes("execution reverted")) {
          if (!error.data || error.data === "0x") {
            // Handle case with no error data
            console.log("Contract reverted without specific error data");

            // Try to diagnose common issues
            try {
              // Check if deposits are paused
              const paused = await diamondContract.depositsPaused();
              if (paused) {
                throw new Error("Deposits are currently paused");
              }

              // Check for emergency shutdown
              const shutdown = await diamondContract.emergencyShutdown();
              if (shutdown) {
                throw new Error("Vault is in emergency shutdown mode");
              }

              // Check if deposit amount meets minimum requirement
              try {
                const MIN_DEPOSIT = 1_000_000; // 1 USDC in wei (6 decimals)
                if (ethers.getBigInt(amountWei) < BigInt(MIN_DEPOSIT)) {
                  throw new Error(`Minimum deposit is 1 USDC`);
                }
              } catch (minCheckError) {
                console.warn("Error checking minimum deposit:", minCheckError);
              }

              // Check if swap contract is set
              const swapContract = await diamondContract.swapContract();
              if (swapContract === ethers.ZeroAddress) {
                throw new Error("Swap contract not configured");
              }

              // Check if receiver contract is set
              const receiverContract = await diamondContract.receiverContract();
              if (receiverContract === ethers.ZeroAddress) {
                throw new Error("Receiver contract not configured");
              }

              // Check for large deposit timelock
              try {
                const totalAssets = await diamondContract.totalAssets();
                const isLargeDeposit =
                  totalAssets > 0 &&
                  ethers.getBigInt(amountWei) >
                    ethers.getBigInt(totalAssets) / BigInt(10);

                if (isLargeDeposit) {
                  const unlockTime =
                    await diamondContract.largeDepositUnlockTime(
                      formattedAddress
                    );
                  if (
                    unlockTime === BigInt(0) ||
                    BigInt(Math.floor(Date.now() / 1000)) < unlockTime
                  ) {
                    throw new Error("Large deposit requires queueing first");
                  }
                }
              } catch (largeDepositError) {
                if (largeDepositError.message.includes("Large deposit")) {
                  throw largeDepositError;
                }
                console.warn(
                  "Error checking large deposit:",
                  largeDepositError
                );
              }

              // If all checks pass but still failing, provide a general message
              throw new Error(
                "Transaction failed: The vault cannot process your deposit at this time. Please try again later or contact support."
              );
            } catch (diagError: any) {
              if (
                diagError.message.startsWith("Deposits") ||
                diagError.message.startsWith("Vault") ||
                diagError.message.startsWith("Swap") ||
                diagError.message.startsWith("Receiver") ||
                diagError.message.startsWith("Minimum") ||
                diagError.message.startsWith("Large") ||
                diagError.message.startsWith("Transaction")
              ) {
                throw diagError;
              }
            }
          }
        }
      }

      // If we can't decode the error, just pass it through
      throw error;
    }

    // Execute deposit with gas limit override
    const gasEstimate = await diamondContract.deposit.estimateGas(
      amountWei,
      formattedAddress
    );

    // Use a higher buffer for complex operations
    const adjustedGasLimit = Math.min(
      Math.floor(Number(gasEstimate) * 1.5),
      1_500_000
    ); // Increased to 50% buffer

    console.log("Deposit gas:", {
      estimated: gasEstimate.toString(),
      withBuffer: adjustedGasLimit.toString(),
    });

    try {
      const tx = await diamondContract.deposit(amountWei, formattedAddress, {
        gasLimit: BigInt(adjustedGasLimit),
      });

      console.log("Deposit transaction sent:", tx.hash);

      // Wait for transaction confirmation
      const receipt = await tx.wait(1);
      console.log("Transaction confirmed:", receipt);

      // Calculate shares received
      const expectedShares = await diamondContract.previewDeposit(amountWei);
      const sharesReceived = Number(ethers.formatUnits(expectedShares, 18));

      return {
        success: true,
        txHash: receipt.hash,
        shares: sharesReceived,
      };
    } catch (txError: any) {
      console.error("Transaction execution failed:", txError);

      // Add specific checks for transaction failures
      if (txError.message?.includes("insufficient funds")) {
        throw new Error(
          "Insufficient ETH for gas fees. Please add more ETH to your wallet."
        );
      }

      throw txError;
    }
  };

  const queueLargeDeposit = async () => {
    if (!diamondContract) return;
    try {
      const tx = await diamondContract.queueLargeDeposit();
      await tx.wait();
      toast.success("Large deposit queued", {
        description:
          "Your large deposit has been queued. You can deposit after the timelock period.",
      });
    } catch (error) {
      console.error("Failed to queue large deposit:", error);
      toast.error("Failed to queue deposit");
    }
  };

  // Real deposit function that interacts with the blockchain
  const deposit = async (amount: number) => {
    if (!isConnected || !address) throw new Error("Wallet not connected");
    if (!diamondContract?.target)
      throw new Error("Diamond contract not initialized");
    if (!usdcContract?.target) throw new Error("USDC contract not initialized");

    if (amount < 1) {
      toast.error("Minimum deposit is 1 USDC", {
        description: "Please increase your deposit amount to at least 1 USDC.",
      });
      return;
    }

    // Generate a unique transaction ID to track this deposit
    const transactionId = `deposit-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    let pendingToast: string | number | null = null;

    try {
      // Show pending toast with more information
      pendingToast = toast.loading(
        `Preparing deposit of $${amount.toLocaleString()}...`,
        {
          duration: 60000, // Long duration since we'll manually dismiss
        }
      );

      // Create & add pending transaction record
      const pendingTx: Transaction = {
        type: "deposit",
        amount,
        shares: 0,
        timestamp: Date.now(),
        status: "pending",
        id: transactionId,
      };
      setTransactions((prev) => [pendingTx, ...prev]);

      const configCheck = await checkContractConfiguration();
      console.log("Configuration check:", configCheck);

      if (!configCheck?.isConfigurationValid) {
        // Update toast to show configuration issues
        toast.error("Contract configuration error", {
          id: pendingToast,
          description: `The vault has configuration issues: ${configCheck?.issues?.join(
            ", "
          )}`,
        });

        // Clean up the pending transaction
        setTransactions((prev) =>
          prev.map((tx) =>
            tx.status === "pending" && tx.id === transactionId
              ? { ...tx, status: "failed", error: "Configuration error" }
              : tx
          )
        );

        throw new Error(
          `Contract configuration error: ${configCheck?.issues?.join(", ")}`
        );
      }

      // Run preliminary contract checks in parallel
      const [totalAssets, usdcBalance, usdcDecimals] = await Promise.all([
        diamondContract.totalAssets(),
        usdcContract.balanceOf(address),
        usdcContract.decimals().catch(() => 6), // Default to 6 if call fails
      ]);

      // Format amount using actual token decimals
      const amountWei = ethers.parseUnits(amount.toString(), usdcDecimals);

      // Check USDC balance before proceeding
      if (ethers.getBigInt(usdcBalance) < ethers.getBigInt(amountWei)) {
        throw new Error(
          `Insufficient USDC balance. You have ${ethers.formatUnits(
            usdcBalance,
            usdcDecimals
          )} USDC.`
        );
      }

      // Check if this is a large deposit (>10% of vault)
      const isLargeDeposit =
        totalAssets > 0 &&
        ethers.getBigInt(amountWei) >
          ethers.getBigInt(totalAssets) / BigInt(10);

      // Handle large deposits properly
      if (isLargeDeposit) {
        // Update toast to indicate checking unlock time
        toast.loading("Checking timelock status...", {
          id: pendingToast,
        });

        const unlockTime = await diamondContract.largeDepositUnlockTime(
          address
        );

        if (unlockTime === 0 || Date.now() / 1000 < Number(unlockTime)) {
          // Clean up the pending transaction
          setTransactions((prev) =>
            prev.filter(
              (tx) => !(tx.status === "pending" && tx.id === transactionId)
            )
          );

          // Update toast to error state
          toast.error("Large deposit requires queueing", {
            id: pendingToast,
            description:
              "This deposit exceeds 10% of vault assets and needs to be queued first.",
          });

          // Prompt user to queue the deposit
          const shouldQueue = window.confirm(
            "Would you like to queue this large deposit now? You'll be able to complete it after the timelock period."
          );

          if (shouldQueue) {
            return await queueLargeDeposit();
          }

          return;
        }

        // Let user know deposit will proceed
        toast.loading("Timelock completed. Proceeding with deposit...", {
          id: pendingToast,
        });
      }

      // Update toast to show approval/deposit progress
      toast.loading("Processing deposit transaction...", {
        id: pendingToast,
      });

      // Execute deposit with more detailed error handling
      const result = await approveAndDeposit(
        diamondContract,
        usdcContract,
        amount,
        address
      );

      // Update UI state atomically
      setUserShares((prev) => prev + result.shares);

      // Update transaction in a single state update
      setTransactions((prev) => [
        {
          ...pendingTx,
          shares: result.shares,
          status: "completed",
          txHash: result.txHash,
        },
        ...prev.filter(
          (tx) => !(tx.status === "pending" && tx.id === transactionId)
        ),
      ]);

      // Refresh vault data in background
      refreshVaultData().catch((err) =>
        console.warn("Background refresh failed:", err)
      );

      // Show success toast with transaction link
      toast.success("Deposit successful", {
        id: pendingToast,
        description: (
          <div>
            <p>
              You have deposited ${amount.toLocaleString()} and received{" "}
              {result.shares.toFixed(4)} shares
            </p>
            {result.txHash && (
              <a
                href={`https://holesky.etherscan.io/tx/${result.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                View transaction on Etherscan →
              </a>
            )}
          </div>
        ),
      });

      return result;
    } catch (error: any) {
      console.error("Deposit failed:", error);

      // Clean up the pending transaction
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.status === "pending" && tx.id === transactionId
            ? { ...tx, status: "failed", error: error.message }
            : tx
        )
      );

      // Provide more helpful error messages based on error types
      let errorMessage =
        error.message || "Transaction failed. Please try again.";
      let actionSuggestion = "";

      // Handle common error cases with specific suggestions
      if (errorMessage.includes("user rejected")) {
        errorMessage = "Transaction was rejected.";
        actionSuggestion = "You can try again when you're ready.";
      } else if (errorMessage.includes("insufficient funds for gas")) {
        errorMessage = "Not enough ETH for transaction fees.";
        actionSuggestion = "Please add more ETH to your wallet.";
      } else if (errorMessage.includes("MinimumDepositNotMet")) {
        actionSuggestion = "The minimum deposit amount is 100 USDC.";
      } else if (errorMessage.includes("execution reverted")) {
        // Try to provide more context
        actionSuggestion =
          "There may be an issue with the vault configuration. Try a smaller amount or contact support.";
      }

      // Show error toast with detailed information
      toast.error("Deposit failed", {
        id: pendingToast,
        description: (
          <div className="space-y-2">
            <p className="font-medium">{errorMessage}</p>
            {actionSuggestion && <p className="text-sm">{actionSuggestion}</p>}
          </div>
        ),
      });

      throw error; // Re-throw for promise chaining
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
      const gasEstimate = await diamondContract.withdraw.estimateGas(
        amountWei,
        address,
        address
      );
      const adjustedGasLimit = Math.floor(Number(gasEstimate) * 1.2); // Add 20% buffer

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
      setTransactions((prev) => [pendingTx, ...prev]);

      // Get fee data for gas optimization
      if (!provider) {
        throw new Error("Provider not available");
      }
      const feeData = await provider.getFeeData();

      // Execute withdrawal
      const tx = await diamondContract.withdraw(amountWei, address, address, {
        gasLimit: BigInt(adjustedGasLimit),
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      });

      // Wait for transaction confirmation
      const receipt = await tx.wait(1);

      // Update UI state with burned shares
      setUserShares(
        (prev) => prev - Number(ethers.formatUnits(sharesToBurn, 18))
      );

      // Update transactions
      const completedTx: Transaction = {
        ...pendingTx,
        status: "completed",
      };
      setTransactions((prev) => [
        completedTx,
        ...prev.filter((tx) => tx !== pendingTx),
      ]);

      // Refresh vault data
      await refreshVaultData();

      // Show success toast
      toast.dismiss(pendingToast);
      toast.success("Withdrawal successful", {
        description: `You have withdrawn $${amount} by burning ${Number(
          ethers.formatUnits(sharesToBurn, 18)
        ).toFixed(6)} shares`,
      });
    } catch (error: any) {
      console.error("Withdrawal failed:", error);

      // Update failed transaction
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.status === "pending" &&
          tx.type === "withdraw" &&
          tx.amount === amount
            ? { ...tx, status: "failed" }
            : tx
        )
      );

      // Show error toast
      let errorMessage = "Unknown error occurred";

      if (error.message) {
        if (error.message.includes("Amount exceeds unlocked balance")) {
          errorMessage =
            "You're trying to withdraw locked funds. Check unlock times.";
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
    if (!diamondContract) return;

    try {
      // Convert fee percentage to contract format if needed
      const feeValue = ethers.parseUnits(fee.toString(), 2); // Assuming 2 decimals

      const tx = await diamondContract.setPerformanceFee(feeValue);
      await tx.wait();

      setVaultData((prev) => ({
        ...prev,
        currentFee: fee,
      }));

      toast.success("Fee updated", {
        description: `Performance fee has been set to ${fee}%`,
      });
    } catch (error) {
      console.error("Error updating fee:", error);
      toast.error("Failed to update performance fee");
      throw error;
    }
  };

  // Admin function to toggle pause
  const togglePause = async (paused: boolean): Promise<void> => {
    if (!diamondContract) return;

    try {
      // Call the appropriate contract function
      const tx = await diamondContract.setDepositsPaused(paused);
      await tx.wait();

      if (paused) {
        toast.error("Vault paused", {
          description: "All deposits and withdrawals are now paused",
        });
      } else {
        toast.success("Vault resumed", {
          description: "The vault is now active again",
        });
      }

      await refreshVaultData();
    } catch (error) {
      console.error("Error toggling pause state:", error);
      toast.error("Failed to update vault pause state");
      throw error;
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
        triggerDailyUpdate,
        fetchLidoAPY,
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
