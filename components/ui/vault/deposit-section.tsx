"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useVault } from "@/context/vault-context"
import { useWallet } from "@/context/wallet-context"
import { ArrowRight, Info, AlertCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function DepositSection() {
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const { vaultData, refreshVaultData, deposit } = useVault()
  const { usdcBalance, isConnected } = useWallet()
  const MIN_DEPOSIT = 1;
  
  const handleDeposit = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return;
    
    if (!isConnected) {
      toast.error("Wallet not connected", {
        description: "Please connect your wallet first"
      });
      return;
    }

    if (Number.parseFloat(amount) < MIN_DEPOSIT) {
      toast.error("Minimum deposit required", {
        description: `Please deposit at least ${MIN_DEPOSIT} USDC`
      });
      return;
    }

    setIsLoading(true);
    const amountNum = Number.parseFloat(amount);
    
    try {
      toast.info("Processing deposit...");
      setIsApproving(true);
      // Use the vault context deposit function
      await deposit(amountNum);
      await refreshVaultData();
      // Clear input after successful deposit
      setAmount("");
      
    } catch (error: any) {
      console.error("Deposit failed:", error);
      
      // More detailed error handling
      let errorMessage = "Unknown error occurred";
      
      if (error.message) {
        if (error.message.includes("MinimumDepositNotMet")) {
          errorMessage = "Amount below minimum deposit requirement";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient ETH for gas fees";
        } else if (error.message.includes("LargeDepositNotTimelocked")) {
          errorMessage = "Large deposit requires timelock period";
        } else if (error.message.includes("DepositsPaused")) {
          errorMessage = "Deposits are currently paused";
        } else if (error.message.includes("EmergencyShutdown")) {
          errorMessage = "The vault is in emergency shutdown mode";
        } else if (error.message.includes("ZeroAmount")) {
          errorMessage = "Cannot deposit zero amount";
        } else if (error.message.includes("Swap contract not set")) {
          errorMessage = "Vault configuration issue - please contact support";
        } else {
          errorMessage = error.message;
        }
      }
      
      toast.error("Deposit failed", { description: errorMessage });
    } finally {
      setIsLoading(false);
      setIsApproving(false);
    }
  }

  const estimatedShares = amount && vaultData.exchangeRate 
    ? Number.parseFloat(amount) / vaultData.exchangeRate 
    : 0;

  const formattedBalance = typeof usdcBalance === 'number' 
    ? usdcBalance.toLocaleString('en-US', { 
        maximumFractionDigits: 2,
        minimumFractionDigits: 2
      })
    : '0.00';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deposit & Mint Shares</CardTitle>
        <CardDescription>Deposit USDC and receive vault shares</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="deposit-amount"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Amount to Deposit
              </label>
              <span className="text-xs text-muted-foreground">Balance: {formattedBalance} USDC</span>
            </div>
            <div className="flex space-x-2">
              <Input
                id="deposit-amount"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isLoading || isApproving}
              />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setAmount(usdcBalance.toString())}
                disabled={isLoading || isApproving || usdcBalance <= 0}
              >
                Max
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center">
                <span>Estimated Shares</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 ml-1 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Shares represent your ownership in the vault</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <span className="font-medium">{estimatedShares.toFixed(6)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span>Exchange Rate</span>
              <span className="font-medium">1 Share = ${vaultData.exchangeRate}</span>
            </div>
          </div>

          {Number.parseFloat(amount) > 0 && (
            <div className="rounded-lg bg-yellow-50 dark:bg-cyan-950/30 p-3 text-xs flex items-start gap-2 text-cyan-800 dark:text-cyan-400">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Deposit Info</p>
                <p className="mt-1"><b className="text-orange-500">40%</b> of your deposit will be staked via Lido to generate yield. Staked assets have a <b className="text-orange-500">30-day Lock-in period.</b></p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleDeposit}
          disabled={
            isLoading || 
            isApproving || 
            !amount || 
            Number.parseFloat(amount) <= 0 || 
            !isConnected || 
            Number.parseFloat(amount) > usdcBalance
          }
        >
          {isApproving ? "Approving USDC..." : isLoading ? "Processing..." : "Deposit"}
          {!isLoading && !isApproving && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </CardFooter>
    </Card>
  )
}