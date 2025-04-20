"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useVault } from "@/context/vault-context"
import { useWallet } from "@/context/wallet-context"
import { toast } from "sonner"
import { ArrowRight, Info, AlertCircle, Clock } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ethers } from "ethers"

const DIAMOND_ABI = [
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function previewWithdraw(uint256 assets) public view returns (uint256)",
  "function maxWithdraw(address owner) external view returns (uint256)",
  "function getWithdrawableAmount(address user) external view returns (uint256)",
  "function getLockedAmount(address user) external view returns (uint256)",
  "function getUnlockTime(address user) external view returns (uint256[])"
];

export function WithdrawSection() {
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [withdrawableAmount, setWithdrawableAmount] = useState("0")
  const [lockedAmount, setLockedAmount] = useState("0")
  const [unlockTimes, setUnlockTimes] = useState<number[]>([])
  const [isChecking, setIsChecking] = useState(true)
  const { vaultData, userShares, refreshVaultData, withdraw } = useVault()
  const { isConnected, address, provider } = useWallet()
  const [isPending, setIsPending] = useState(false)

  // Contract addresses from environment variables
  const diamondAddress = process.env.NEXT_PUBLIC_DIAMOND_ADDRESS;
  
  // Effect to fetch withdrawable amount when component mounts or address changes
  useEffect(() => {
    if (isConnected && address && provider && diamondAddress) {
      fetchWithdrawableAmount();
    } else {
      setWithdrawableAmount("0");
      setLockedAmount("0");
      setUnlockTimes([]);
      setIsChecking(false);
    }
  }, [isConnected, address, provider, userShares, diamondAddress]);

  // Fetch withdrawable amount and locked amounts
  const fetchWithdrawableAmount = async () => {
    setIsChecking(true);
    try {
      const signer = await provider!.getSigner();
      const diamondContract = new ethers.Contract(diamondAddress!, DIAMOND_ABI, signer);

      // Get withdrawable amount
      const withdrawable = await diamondContract.getWithdrawableAmount(address);
      setWithdrawableAmount(ethers.formatUnits(withdrawable, 6));
      
      // Get locked amount
      const locked = await diamondContract.getLockedAmount(address);
      setLockedAmount(ethers.formatUnits(locked, 6));
      
      // Get unlock times if there are locked amounts
      if (ethers.getBigInt(locked) !== BigInt(0)) {
        const times = await diamondContract.getUnlockTime(address);
        setUnlockTimes(times.map((t)=> Number(t)));
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
    const maxWithdrawable = Number.parseFloat(withdrawableAmount);
    
    if (withdrawAmount > maxWithdrawable) {
      toast.error("Withdrawal limit exceeded", {
        description: `Maximum withdrawable amount: ${maxWithdrawable.toFixed(2)} USDC`
      });
      return;
    }

    setIsLoading(true);
    setIsPending(true);
    try {
      // Call the withdraw function from vault context
      await withdraw(withdrawAmount);
      
      // Reset form and refresh data
      setAmount("");
      
      await fetchWithdrawableAmount();
      await refreshVaultData();
    
      toast.success("Withdrawal successful", {
        description: `You have withdrawn ${withdrawAmount.toFixed(2)} USDC`
      });

    } catch (error: any) {
      console.error("Withdrawal failed:", error);
      toast.error("Withdrawal failed", { 
        description: error.message || "Transaction failed. Please try again." 
      });
    } finally {
      setIsLoading(false);
      setIsPending(false);
    }
  };

  // Format unlock times for display
  const getFormattedUnlockTime = () => {
    if (unlockTimes.length === 0) return null;
    
    // Find the soonest unlock time
    const now = Math.floor(Date.now() / 1000);
    const nextUnlock = unlockTimes
      .filter(time => time > now)
      .sort((a, b) => a - b)[0];
    
    if (!nextUnlock) return null;
    
    const unlockDate = new Date(nextUnlock * 1000);
    const remainingTime = nextUnlock - now;
    const days = Math.floor(remainingTime / 86400);
    const hours = Math.floor((remainingTime % 86400) / 3600);
    
    return {
      date: unlockDate.toLocaleString(),
      remaining: `${days}d ${hours}h`
    };
  };

  const unlockInfo = getFormattedUnlockTime();
  const hasLockedFunds = Number(lockedAmount) > 0;
  
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
              <span className="text-xs text-muted-foreground">
                Available: {isChecking ? "Loading..." : parseFloat(withdrawableAmount).toLocaleString()} USDC
              </span>
            </div>
            <div className="flex space-x-2">
              <Input
                id="withdraw-amount"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isLoading || isChecking}
              />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setAmount(withdrawableAmount)}
                disabled={isLoading || isChecking || parseFloat(withdrawableAmount) <= 0}
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
                {amount ? (Number.parseFloat(amount) / vaultData.exchangeRate).toFixed(6) : "0.000000"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span>Exchange Rate</span>
              <span className="font-medium">1 Share = ${vaultData.exchangeRate}</span>
            </div>
          </div>

          {hasLockedFunds && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-xs flex items-start gap-2 text-amber-800 dark:text-amber-400">
              <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Locked Funds</p>
                <p className="mt-1">
                  You have {parseFloat(lockedAmount).toFixed(2)} USDC locked.
                  {unlockInfo && (
                    <> Next unlock: {unlockInfo.date} (in {unlockInfo.remaining})</>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-xs flex items-start gap-2 text-blue-800 dark:text-blue-400">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Withdrawal Info</p>
              <p className="mt-1">40% of your funds are staked via Lido. If your withdrawal includes staked assets, you'll need to wait for the <b className="text-yellow-500">Vaultopia standard unstaking period (30 days).</b></p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleWithdraw}
          disabled={
            isLoading || 
            isChecking ||
            isPending ||
            !amount || 
            Number.parseFloat(amount) <= 0 || 
            !isConnected || 
            Number.parseFloat(amount) > parseFloat(withdrawableAmount)
          }
        >
          {isLoading ? "Processing..." : isChecking ? "Loading..." : isPending? "Please wait..." : "Withdraw"}
          {!isLoading && !isChecking && !isPending && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </CardFooter>
    </Card>
  );
}