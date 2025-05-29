"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useVault } from "@/context/vault-context";
import { useWallet } from "@/context/wallet-context";
import { toast } from "sonner";
import {
  ArrowRight,
  Info,
  AlertCircle,
  Clock,
  CheckCircle,
  HelpCircle,
  LockIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ethers } from "ethers";
import { Progress } from "@/components/ui/progress";
import { DIAMOND_ABI } from "@/context/vault-context";

export function WithdrawSection() {
  const [amount, setAmount] = useState("");
  const [withdrawableAmount, setWithdrawableAmount] = useState("0");
  const [lockedAmount, setLockedAmount] = useState("0");
  const [totalDeposits, setTotalDeposits] = useState("0");
  const [usedLiquidPortion, setUsedLiquidPortion] = useState("0");
  const [unlockTimes, setUnlockTimes] = useState<number[]>([]);
  const [isChecking, setIsChecking] = useState(true);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const { vaultData, userShares, refreshVaultData, withdraw } = useVault();
  const { isConnected, address, provider } = useWallet();
  const diamondAddress = "0xeDDd2e87AC99FC7B2d65793bBB6685559eEE3173";

  // Effect to fetch withdrawable amount when component mounts or address changes
  useEffect(() => {
    if (isConnected && address && provider && diamondAddress) {
      fetchWithdrawalAmount();
    } else {
      setWithdrawableAmount("0");
      setLockedAmount("0");
      setTotalDeposits("0");
      setUsedLiquidPortion("0");
      setUnlockTimes([]);
      setIsChecking(false);
    }
  }, [isConnected, address, provider, userShares, diamondAddress]);

  const fetchWithdrawalAmount = async () => {
    setIsChecking(true);
    try {
      const signer = await provider!.getSigner();
      const diamondContract = new ethers.Contract(
        diamondAddress!,
        DIAMOND_ABI,
        signer
      );

      // Use the new comprehensive function
      const withdrawalDetails = await diamondContract.getWithdrawalDetails(
        address
      );

      // Destructure all values returned by the function
      const [
        totalDeposit,
        totalLiquid,
        usedLiquid,
        remainingLiquid,
        lockedAmount,
        maturedLockedAmount,
        totalWithdrawable,
      ] = withdrawalDetails;

      // Set state with properly formatted values
      setWithdrawableAmount(ethers.formatUnits(totalWithdrawable, 6));
      setLockedAmount(ethers.formatUnits(lockedAmount, 6));
      setTotalDeposits(ethers.formatUnits(totalDeposit, 6));
      setUsedLiquidPortion(ethers.formatUnits(usedLiquid, 6));

      // Display actual values to user for clarity
      console.log("Withdrawal details:", {
        totalDeposit: ethers.formatUnits(totalDeposit, 6),
        totalLiquid: ethers.formatUnits(totalLiquid, 6),
        usedLiquid: ethers.formatUnits(usedLiquid, 6),
        remainingLiquid: ethers.formatUnits(remainingLiquid, 6),
        lockedAmount: ethers.formatUnits(lockedAmount, 6),
        maturedLocked: ethers.formatUnits(maturedLockedAmount, 6),
        totalWithdrawable: ethers.formatUnits(totalWithdrawable, 6),
      });

      // Get unlock times if there are locked funds
      if (ethers.getBigInt(lockedAmount) !== BigInt(0)) {
        const times = await diamondContract.getUnlockTime(address);
        setUnlockTimes(times.map((t) => Number(t)));
      } else {
        setUnlockTimes([]);
      }
    } catch (error) {
      console.error("Failed to fetch withdrawable amount:", error);
      toast.error("Failed to fetch withdrawable amount");
    } finally {
      setIsChecking(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return;

    const withdrawAmount = Number.parseFloat(amount);

    // Check if amount is greater than withdrawable before sending transaction
    if (withdrawAmount > parseFloat(withdrawableAmount)) {
      toast.error("Withdrawal limit exceeded", {
        description: `You can only withdraw up to ${parseFloat(
          withdrawableAmount
        ).toLocaleString()} USDC at this time.`,
      });
      return;
    }

    setIsWithdrawing(true);
    try {
      await withdraw(withdrawAmount);
      setAmount("");
      await fetchWithdrawalAmount(); // Refresh after withdrawal
    } catch (error) {
      console.error("Withdrawal failed:", error);
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Format unlock times for display
  const getFormattedUnlockTime = () => {
    if (unlockTimes.length === 0) return null;

    // Find the soonest unlock time
    const now = Math.floor(Date.now() / 1000);
    const futureUnlocks = unlockTimes.filter((time) => time > now);

    if (futureUnlocks.length === 0) return null;

    const nextUnlock = Math.min(...futureUnlocks);
    const unlockDate = new Date(nextUnlock * 1000);
    const remainingTime = nextUnlock - now;
    const days = Math.floor(remainingTime / 86400);
    const hours = Math.floor((remainingTime % 86400) / 3600);

    return {
      date: unlockDate.toLocaleDateString(),
      time: unlockDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      remaining: `${days}d ${hours}h`,
      timestamp: nextUnlock,
    };
  };

  const unlockInfo = getFormattedUnlockTime();
  const hasLockedFunds = Number(lockedAmount) > 0;
  const totalDepositVal = parseFloat(totalDeposits);

  // Calculate the liquid portion percentage used
  const totalLiquidPortion = totalDepositVal * 0.6; // 60% of deposits
  const usedLiquidVal = parseFloat(usedLiquidPortion);
  const liquidPortionUsedPercentage =
    totalLiquidPortion > 0
      ? Math.min(100, (usedLiquidVal / totalLiquidPortion) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdraw Funds</CardTitle>
        <CardDescription>Convert your vault shares to USDC</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="withdraw-amount"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Amount to Withdraw (USDC)
              </label>
              <div className="flex items-center">
                <span className="text-xs text-muted-foreground">
                  Available:{" "}
                  {isChecking
                    ? "Loading..."
                    : parseFloat(withdrawableAmount).toLocaleString()}{" "}
                  USDC
                </span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 ml-1 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p>
                        This is the exact amount you can withdraw right now. It
                        includes your remaining liquid portion (60% of deposits,
                        minus what you've already withdrawn) plus any matured
                        deposits.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
            <div className="flex space-x-2">
              <Input
                id="withdraw-amount"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isChecking || isWithdrawing}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAmount(withdrawableAmount)}
                disabled={
                  isChecking ||
                  isWithdrawing ||
                  parseFloat(withdrawableAmount) <= 0
                }
              >
                Max
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center">
                <span>Estimated Shares to Burn</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 ml-1 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Shares that will be burned for this withdrawal</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <span className="font-medium">
                {amount && Number.parseFloat(amount) > 0
                  ? (
                      Number.parseFloat(amount) / vaultData.exchangeRate
                    ).toFixed(6)
                  : "0.000000"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span>Exchange Rate</span>
              <span className="font-medium">
                1 Share = ${vaultData.exchangeRate.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Liquid Portion Usage Tracker */}
          {totalDepositVal > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <span className="font-medium">
                    Immediate Withdrawal Limit
                  </span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 ml-1 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px]">
                        <p>
                          You can withdraw up to 60% of your deposits
                          immediately.{" "}
                          {usedLiquidVal >= totalLiquidPortion
                            ? "You've already withdrawn your liquid portion, so the remaining funds are locked for the 30-day period."
                            : `You've used ${usedLiquidVal.toFixed(
                                2
                              )} of your ${totalLiquidPortion.toFixed(
                                2
                              )} USDC liquid allocation.`}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                {/* Show actual withdrawal history */}
                {parseFloat(withdrawableAmount) > 0 ? (
                  <span className="text-sm">
                    {parseFloat(withdrawableAmount).toFixed(2)} USDC available
                  </span>
                ) : (
                  <span className="text-sm text-amber-600">
                    Fully used ({usedLiquidVal.toFixed(2)} USDC withdrawn)
                  </span>
                )}
              </div>

              {/* Progress bar showing used percentage */}
              <Progress value={liquidPortionUsedPercentage} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span
                  className={
                    liquidPortionUsedPercentage >= 100
                      ? "text-red-500 font-medium"
                      : ""
                  }
                >
                  {Math.min(100, liquidPortionUsedPercentage).toFixed(0)}%
                </span>
                <span>100%</span>
              </div>
            </div>
          )}

          {/* Update the locked funds info card */}
          {hasLockedFunds && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-xs flex items-start gap-2 text-amber-800 dark:text-amber-400">
              <LockIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">
                  Locked Funds (40% of your deposit)
                </p>
                <p className="mt-1">
                  You have {parseFloat(lockedAmount).toFixed(2)} USDC locked
                  from your total deposit of {totalDepositVal.toFixed(2)} USDC.
                  {unlockInfo && (
                    <>
                      {" "}
                      Unlock date: {unlockInfo.date} at {unlockInfo.time} (in{" "}
                      {unlockInfo.remaining})
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-xs flex items-start gap-2 text-blue-800 dark:text-blue-400">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Withdrawal Info</p>
              <p className="mt-1">
                60% of your funds are available for immediate withdrawal. The
                remaining 40% are staked via Lido for the{" "}
                <b className="text-yellow-500">standard 30-day lock period</b>.
                Once you've used your immediate withdrawal portion, you'll need
                to wait for deposits to mature.
              </p>
            </div>
          </div>

          {Number(withdrawableAmount) > 0 && (
            <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3 text-xs flex items-start gap-2 text-green-800 dark:text-green-400">
              <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Available for Withdrawal</p>
                <p className="mt-1">
                  You can withdraw up to{" "}
                  {parseFloat(withdrawableAmount).toFixed(2)} USDC immediately.
                  {Number(lockedAmount) > 0 && (
                    <>
                      {" "}
                      The remaining {parseFloat(lockedAmount).toFixed(2)} USDC
                      will be available after the lock period.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleWithdraw}
          disabled={
            isChecking ||
            isWithdrawing ||
            !amount ||
            Number.parseFloat(amount) <= 0 ||
            !isConnected ||
            Number.parseFloat(amount) > parseFloat(withdrawableAmount)
          }
        >
          {isChecking
            ? "Checking available funds..."
            : isWithdrawing
            ? "Processing withdrawal..."
            : "Withdraw"}
          {!isChecking && !isWithdrawing && (
            <ArrowRight className="ml-2 h-4 w-4" />
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
