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
export const DIAMOND_ABI = [
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
  "function getUsedLiquidPortion(address user) external view returns (uint256)",
  "function getRemainingLiquidPortion(address user) external view returns (uint256)",
  "function convertToAssets(uint256 shares) public view returns (uint256)",
  "function getWithdrawalDetails(address user) external view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
  // Admin functions
  "function setPerformanceFee(uint256 fee) external",
  "function setDepositsPaused(bool paused) external",
  "function collectFees() external",
  "function toggleEmergencyShutdown() external",
  "function setLidoWithdrawalAddress(address) external",
  "function setLidoContract(address) external",
  "function setWstETHAddress(address) external",
  "function setReceiverContract(address) external",
  "function setSwapContract(address) external",
  "function setFeeCollector(address) external",
  "function updateWstETHBalance(address user, uint256 amount) external",
  "function triggerDailyUpdate() external",
  "function safeTransferAndSwap(address,uint256) public returns (uint256)",
  "function simplifiedDeposit(uint256 assets, address receiver) external returns (uint256)",
  "function checkContractSetup() external view returns (bool, bool, bool, bool, uint256)",
  "function checkWithdrawalStatus(address user) external view returns (bool inProgress, bool isFinalized)",
  "function recoverStuckBatch(bytes32 batchId) external",
  "function resetStuckWithdrawalState(address user) external",

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
  id?: string;
  error?: string;
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
  deposit: (
    amount: number
  ) => Promise<void | { success: boolean; txHash: any; shares: number }>;
  withdraw: (amount: number) => Promise<void>;
  setFee: (fee: number) => Promise<void>;
  togglePause: (paused: boolean) => Promise<void>;
  refreshVaultData: (includeTransactions?: boolean) => Promise<void>;
  setLidoWithdrawalAddress: (address: string) => Promise<void>;
  setLidoContract: (address: string) => Promise<void>;
  setWstETHAddress: (address: string) => Promise<void>;
  setReceiverContract: (address: string) => Promise<void>;
  setSwapContract: (address: string) => Promise<void>;
  setFeeCollector: (address: string) => Promise<void>;
  toggleEmergencyShutdown: () => Promise<void>;
  collectAccumulatedFees: () => Promise<void>;
  updateWstETHBalance: (user: string, amount: number) => Promise<void>;
  triggerDailyUpdate: () => Promise<void>;
  fetchLidoAPY: () => Promise<number | null>;
  simplifiedDeposit: (
    amount: number
  ) => Promise<{ success: boolean; txHash: any; shares: number }>;
  checkContractSetup: () => Promise<{
    swapContractSet: boolean;
    receiverContractSet: boolean;
    lidoContractSet: boolean;
    wstEthContractSet: boolean;
    usdcBalance: number;
  }>;
  checkWithdrawalStatus: (address: string) => Promise<{
    inProgress: boolean;
    isFinalized: boolean;
  }>;
  recoverStuckBatch: (batchId: string) => Promise<void>;
  resetStuckWithdrawalState: (address: string) => Promise<void>;
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
  const STORAGE_KEY_TRANSACTIONS = "vaultopia_transactions";
  const MAX_STORED_TRANSACTIONS = 100;
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
          "https://eth-api-hoodi.testnet.fi/v1/protocol/steth/apr/sma"
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

  const saveTransactionsToLocalStorage = useCallback((txs: Transaction[]) => {
    try {
      // Limit the number of transactions saved to avoid localStorage limits
      const limitedTxs = txs.slice(0, MAX_STORED_TRANSACTIONS);
      localStorage.setItem(
        STORAGE_KEY_TRANSACTIONS,
        JSON.stringify(limitedTxs)
      );
    } catch (error) {
      console.warn("Failed to save transactions to localStorage:", error);
    }
  }, []);

  const updateTransactions = useCallback(
    (txs: Transaction[]) => {
      setTransactions(txs);
      saveTransactionsToLocalStorage(txs);
    },
    [saveTransactionsToLocalStorage]
  );

  const generateTxId = () => {
    return Date.now().toString() + Math.random().toString(36).substring(2, 15);
  };

  useEffect(() => {
    try {
      const savedTransactions = localStorage.getItem(STORAGE_KEY_TRANSACTIONS);
      if (savedTransactions) {
        setTransactions(JSON.parse(savedTransactions));
      }
    } catch (error) {
      console.warn("Failed to load transactions from localStorage:", error);
    }
  }, []);

  // Modify the loadTransactionHistory function
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
      // Look back 14 days (about 100,800 blocks on Ethereum)
      const lookbackBlocks = 100800;
      const startBlock = Math.max(currentBlock - lookbackBlocks, 0);

      console.log(
        `Querying events from block ${startBlock} to ${currentBlock}`
      );

      // Process in chunks to avoid "maximum block range exceeded" errors
      const MAX_BLOCK_RANGE = 2000;

      // Initialize arrays for collecting events
      const allDepositEvents = [];
      const allWithdrawEvents = [];

      // Process block ranges in chunks
      let fromBlock = startBlock;

      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE, currentBlock);

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
        } catch (error) {
          console.error(
            `Error querying events for block range ${fromBlock}-${toBlock}:`,
            error
          );
          // If there's an error, try a smaller range or move on
          fromBlock = toBlock + 1;
        }
      }

      console.log(
        `Found ${allDepositEvents.length} deposits and ${allWithdrawEvents.length} withdrawals`
      );

      // Process deposit events
      const depositTransactions = await Promise.all(
        allDepositEvents.map(async (event) => {
          const block = await event.getBlock();
          return {
            type: "deposit",
            amount: Number(ethers.formatUnits(event.args.assets, 6)),
            shares: Number(ethers.formatUnits(event.args.shares, 18)),
            timestamp: block.timestamp * 1000, // Convert to milliseconds
            status: "completed",
            txHash: event.transactionHash,
            id: event.transactionHash,
          };
        })
      );

      // Process withdrawal events
      const withdrawTransactions = await Promise.all(
        allWithdrawEvents.map(async (event) => {
          const block = await event.getBlock();
          return {
            type: "withdraw",
            amount: Number(ethers.formatUnits(event.args.assets, 6)),
            shares: Number(ethers.formatUnits(event.args.shares, 18)),
            timestamp: block.timestamp * 1000, // Convert to milliseconds
            status: "completed",
            txHash: event.transactionHash,
            id: event.transactionHash,
          };
        })
      );

      // Combine all transactions
      const onChainTxs = [...depositTransactions, ...withdrawTransactions];

      // Add pending transactions that aren't yet confirmed
      const pendingTxs = transactions.filter(
        (tx) =>
          tx.status === "pending" &&
          !onChainTxs.some((onChain) => onChain.txHash === tx.txHash)
      );

      // Sort all transactions by timestamp (newest first)
      const allTransactions = [...pendingTxs, ...onChainTxs].sort(
        (a, b) => b.timestamp - a.timestamp
      );

      console.log("Loaded transactions:", allTransactions);

      // Update the transactions state
      updateTransactions(allTransactions);
    } catch (error) {
      console.error("Error loading transaction history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const setLidoContract = async (address: string) => {
    if (!diamondContract) return;
    try {
      const tx = await diamondContract.setLidoContract(address);
      await tx.wait();
      toast.success("Lido staking contract address updated");
    } catch (error) {
      console.error("Error updating Lido contract:", error);
      toast.error("Failed to update Lido contract address");
      throw error;
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

  const diamondAddress = "0xeDDd2e87AC99FC7B2d65793bBB6685559eEE3173";
  const usdcAddress = "0x1904f0522FC7f10517175Bd0E546430f1CF0B9Fa";

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

  const getVaultData = useCallback(async (contract: ethers.Contract) => {
    const totalAssets = await contract.totalAssets();
    const totalShares = await contract.totalSupply();

    console.log("Raw totalAssets:", totalAssets.toString());
    console.log("Raw totalShares:", totalShares.toString());

    const formattedTotalShares = Number(ethers.formatUnits(totalShares, 18));
    const formattedTotalAssets = Number(ethers.formatUnits(totalAssets, 6));

    // CRITICAL FIX: Check for extremely small share values
    let exchangeRate = 1.0;
    let effectiveTotalShares = formattedTotalShares;
    let shareAdjustmentRatio = 1.0; // Add this variable to track adjustment ratio

    if (formattedTotalShares < 0.00001 && formattedTotalAssets > 0) {
      // The share amount is too small relative to assets - use a fixed rate
      console.warn(
        "Extremely small share amount detected, using fixed exchange rate"
      );
      exchangeRate = 1.0;

      // Calculate adjustment ratio when we adjust the display value
      if (formattedTotalShares > 0) {
        shareAdjustmentRatio = formattedTotalAssets / formattedTotalShares;
      }
      effectiveTotalShares = formattedTotalAssets; // Show equal shares to assets
    } else if (formattedTotalShares > 0) {
      // Normal calculation with safety cap
      exchangeRate = Math.min(
        formattedTotalAssets / formattedTotalShares,
        1000
      );
    }

    return {
      tvl: formattedTotalAssets,
      totalShares: effectiveTotalShares, // Use adjusted share amount for display
      exchangeRate: exchangeRate,
      shareAdjustmentRatio: shareAdjustmentRatio, // Return the adjustment ratio
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
          shareAdjustmentRatio: 1.0,
        };
        if (vaultInfoResult.status === "fulfilled") {
          vaultInfo = vaultInfoResult.value;
          console.log("Vault info processed:", vaultInfo);
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

        // Process user shares with adjustment ratio for consistency
        if (sharesResult.status === "fulfilled") {
          const rawUserShares = sharesResult.value;

          // Apply the same adjustment to user shares as we did to total shares
          // This ensures consistent display and calculations
          if (vaultInfo.shareAdjustmentRatio > 1.0) {
            const adjustedUserShares =
              rawUserShares * vaultInfo.shareAdjustmentRatio;

            console.log("Adjusting user shares:", {
              rawUserShares,
              adjustmentRatio: vaultInfo.shareAdjustmentRatio,
              adjustedUserShares,
            });

            setUserShares(adjustedUserShares);
          } else {
            // No adjustment needed
            setUserShares(rawUserShares);
          }
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

  const deposit = async (amount: number) => {
    // Basic validations
    if (!isConnected || !address) throw new Error("Wallet not connected");
    if (!diamondContract) throw new Error("Diamond contract not initialized");
    if (!usdcContract) throw new Error("USDC contract not initialized");

    if (amount < 1) {
      toast.error("Minimum deposit is 1 USDC");
      return;
    }

    // Start tracking
    const pendingToast = toast.loading(
      `Preparing deposit of $${amount.toLocaleString()}...`
    );

    try {
      // STEP 1: Complete contract health check before proceeding
      toast.loading("Checking contract configuration...", { id: pendingToast });

      // Call checkContractSetup to verify all required contracts are set
      const contractSetup = await checkContractSetup();
      console.log("Contract setup verification:", contractSetup);

      // Validate all required components are properly configured
      if (!contractSetup.swapContractSet) {
        throw new Error("Swap contract not configured");
      }
      if (!contractSetup.receiverContractSet) {
        throw new Error("Receiver contract not configured");
      }
      if (!contractSetup.lidoContractSet) {
        throw new Error("Lido contract not configured");
      }
      if (!contractSetup.wstEthContractSet) {
        throw new Error("wstETH contract not configured");
      }

      // STEP 2: Check user's USDC balance and allowance
      toast.loading("Checking your USDC balance...", { id: pendingToast });
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      const usdcBalance = await usdcContract.balanceOf(address);

      if (ethers.getBigInt(usdcBalance) < ethers.getBigInt(amountWei)) {
        throw new Error(
          `Insufficient USDC balance: ${ethers.formatUnits(
            usdcBalance,
            6
          )} USDC`
        );
      }

      // STEP 3: Handle USDC approval if needed
      toast.loading("Checking allowance...", { id: pendingToast });
      const allowance = await usdcContract.allowance(
        address,
        diamondContract.target
      );

      if (ethers.getBigInt(allowance) < ethers.getBigInt(amountWei)) {
        toast.loading("Approving USDC...", { id: pendingToast });
        const approveTx = await usdcContract.approve(
          diamondContract.target,
          amountWei
        );
        await approveTx.wait();
        console.log("✅ USDC approved successfully");
      }

      // Create pendingTx object BEFORE sending the transaction
      const pendingTx: Transaction = {
        type: "deposit",
        amount,
        shares: 0, // We'll update this after calculating expected shares
        timestamp: Date.now(),
        status: "pending",
        id: generateTxId(),
      };

      // STEP 4: Execute the deposit
      toast.loading("Processing deposit transaction...", { id: pendingToast });

      // Use deposit function
      const tx = await diamondContract.deposit(amountWei, address, {
        gasLimit: BigInt(5000000), // Safe gas limit for deposit
      });

      console.log("Deposit transaction sent:", tx.hash);

      // Update pending transaction with hash
      pendingTx.txHash = tx.hash;

      // Add to transactions list
      updateTransactions([pendingTx, ...transactions]);

      const receipt = await tx.wait(1);
      console.log("Deposit confirmed:", receipt.hash);

      // Calculate shares received
      const expectedShares = await diamondContract.previewDeposit(amountWei);
      const sharesReceived = Number(ethers.formatUnits(expectedShares, 18));

      // Update transaction with completed status and share amount
      const completedTx: Transaction = {
        ...pendingTx,
        status: "completed",
        shares: sharesReceived,
        blockNumber: receipt.blockNumber,
      };

      updateTransactions([
        completedTx,
        ...transactions.filter((tx) => tx !== pendingTx),
      ]);

      // Show success and return result
      toast.success("Deposit successful", {
        id: pendingToast,
        description: `Deposited $${amount} and received ${sharesReceived.toFixed(
          4
        )} shares`,
      });

      // Refresh vault data
      refreshVaultData().catch(console.error);

      return {
        success: true,
        txHash: receipt.hash,
        shares: sharesReceived,
      };
    } catch (error: any) {
      // Error handling remains the same
      console.error("Deposit failed:", error);

      let errorMessage = "Transaction failed";
      let errorDetails = "";

      if (error.message) {
        // Your existing error handling logic
        if (error.message.includes("not configured")) {
          errorMessage = "Contract Configuration Error";
          errorDetails = `${error.message}. Please contact support.`;
        }
        // Other error handling conditions...
      }

      toast.error("Deposit failed", {
        id: pendingToast,
        description: errorDetails
          ? `${errorMessage}: ${errorDetails}`
          : errorMessage,
      });

      throw error;
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

      // Get both unlocked and max withdraw amount for better user feedback
      const [withdrawable, withdrawableAmount, lockedAmount] =
        await Promise.all([
          diamondContract.maxWithdraw(address),
          diamondContract.getWithdrawableAmount(address),
          diamondContract.getLockedAmount(address),
        ]);

      // Log values for debugging
      console.log({
        requestedAmount: ethers.formatUnits(amountWei, 6),
        maxWithdrawable: ethers.formatUnits(withdrawable, 6),
        withdrawableAmount: ethers.formatUnits(withdrawableAmount, 6),
        lockedAmount: ethers.formatUnits(lockedAmount, 6),
      });

      // Check if amount is within withdrawable limit
      if (ethers.getBigInt(withdrawable) < ethers.getBigInt(amountWei)) {
        const maxAmount = ethers.formatUnits(withdrawable, 6);
        throw new Error(
          `Maximum withdrawable amount is ${parseFloat(maxAmount).toFixed(
            2
          )} USDC. You requested ${amount} USDC.${
            ethers.getBigInt(lockedAmount) > BigInt(0)
              ? ` You have ${ethers.formatUnits(
                  lockedAmount,
                  6
                )} USDC still locked.`
              : ""
          }`
        );
      }

      // Try to estimate gas with error handling
      let adjustedGasLimit;
      try {
        const gasEstimate = await diamondContract.withdraw.estimateGas(
          amountWei,
          address,
          address
        );
        adjustedGasLimit = Math.floor(Number(gasEstimate) * 1.2); // Add 20% buffer
      } catch (error: any) {
        console.error("Gas estimation failed:", error);

        // Show specific message for the "Amount exceeds unlocked balance" error
        if (
          error.reason &&
          error.reason.includes("Amount exceeds unlocked balance")
        ) {
          toast.dismiss(pendingToast);
          toast.error("Withdrawal amount exceeds unlocked balance", {
            description: `You have ${parseFloat(
              ethers.formatUnits(withdrawable, 6)
            ).toFixed(2)} USDC available for withdrawal now, and ${parseFloat(
              ethers.formatUnits(lockedAmount, 6)
            ).toFixed(2)} USDC still locked.`,
          });
          return;
        }

        // For other errors, use a generous gas limit as fallback
        adjustedGasLimit = 300000;
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
        id: generateTxId(),
      };
      updateTransactions([pendingTx, ...transactions]);

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
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
      updateTransactions([
        completedTx,
        ...transactions.filter((tx) => tx !== pendingTx),
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
      updateTransactions(
        transactions.map((tx) =>
          tx.status === "pending" &&
          tx.type === "withdraw" &&
          tx.amount === amount
            ? { ...tx, status: "failed", error: error.message }
            : tx
        )
      );

      // Show error toast with improved messaging
      let errorMessage = "Unknown error occurred";
      let errorDetails = "";

      if (error.message) {
        if (error.message.includes("Amount exceeds unlocked balance")) {
          errorMessage = "Cannot withdraw locked funds";
          errorDetails =
            "Some of your funds are still locked. Check the unlock times below.";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient ETH for gas fees";
        } else if (error.message.includes("Maximum withdrawable amount")) {
          // This is our custom error from above
          errorMessage = "Withdrawal limit exceeded";
          errorDetails = error.message;
        } else {
          errorMessage = "Transaction failed";
          errorDetails = error.message;
        }
      }

      toast.error(errorMessage, { description: errorDetails });
    }
  };

  // Implementation of simplifiedDeposit
  const simplifiedDeposit = async (amount: number) => {
    if (!isConnected || !address) throw new Error("Wallet not connected");
    if (!diamondContract?.target)
      throw new Error("Diamond contract not initialized");
    if (!usdcContract?.target) throw new Error("USDC contract not initialized");

    const pendingToast = toast.loading(
      `Preparing simplified deposit of $${amount.toLocaleString()}...`
    );

    try {
      // Convert amount to wei with 6 decimals (USDC)
      const amountWei = ethers.parseUnits(amount.toString(), 6);

      // Check and approve USDC allowance
      const allowance = await usdcContract.allowance(
        address,
        diamondContract.target
      );

      if (ethers.getBigInt(allowance) < ethers.getBigInt(amountWei)) {
        const approveTx = await usdcContract.approve(
          diamondContract.target,
          amountWei
        );
        await approveTx.wait();
      }

      // Execute simplified deposit
      const tx = await diamondContract.simplifiedDeposit(amountWei, address, {
        gasLimit: BigInt(300000), // Lower gas limit since this is simpler
      });

      const receipt = await tx.wait(1);

      // Calculate shares received
      const expectedShares = await diamondContract.previewDeposit(amountWei);
      const sharesReceived = Number(ethers.formatUnits(expectedShares, 18));

      // Update UI
      setUserShares((prev) => prev + sharesReceived);

      toast.success("Simplified deposit successful", {
        id: pendingToast,
        description: `You have deposited $${amount.toLocaleString()} and received ${sharesReceived.toFixed(
          4
        )} shares`,
      });

      refreshVaultData();

      return {
        success: true,
        txHash: receipt.hash,
        shares: sharesReceived,
      };
    } catch (error: any) {
      console.error("Simplified deposit failed:", error);
      toast.error("Deposit failed", {
        id: pendingToast,
        description: error.message || "Transaction failed",
      });
      throw error;
    }
  };

  // Implementation of checkContractSetup
  const checkContractSetup = async () => {
    if (!diamondContract) throw new Error("Diamond contract not initialized");

    const result = await diamondContract.checkContractSetup();

    return {
      swapContractSet: result[0],
      receiverContractSet: result[1],
      lidoContractSet: result[2],
      wstEthContractSet: result[3],
      usdcBalance: Number(ethers.formatUnits(result[4], 6)),
    };
  };

  // Implementation of checkWithdrawalStatus
  const checkWithdrawalStatus = async (userAddress: string) => {
    if (!diamondContract) throw new Error("Diamond contract not initialized");

    const result = await diamondContract.checkWithdrawalStatus(userAddress);

    return {
      inProgress: result[0],
      isFinalized: result[1],
    };
  };

  // Add admin recovery functions
  const recoverStuckBatch = async (batchId: string) => {
    if (!diamondContract) throw new Error("Diamond contract not initialized");

    const tx = await diamondContract.recoverStuckBatch(batchId);
    await tx.wait();
    toast.success("Batch recovery initiated");
  };

  const resetStuckWithdrawalState = async (userAddress: string) => {
    if (!diamondContract) throw new Error("Diamond contract not initialized");

    const tx = await diamondContract.resetStuckWithdrawalState(userAddress);
    await tx.wait();
    toast.success("Withdrawal state reset successfully");
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
        setLidoContract,
        setWstETHAddress,
        setReceiverContract,
        setSwapContract,
        setFeeCollector,
        toggleEmergencyShutdown,
        collectAccumulatedFees,
        updateWstETHBalance,
        triggerDailyUpdate,
        fetchLidoAPY,
        simplifiedDeposit,
        checkContractSetup,
        checkWithdrawalStatus,
        recoverStuckBatch,
        resetStuckWithdrawalState,
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
