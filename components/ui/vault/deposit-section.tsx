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
import { ethers } from "ethers"

// USDC and Diamond ABIs
const DIAMOND_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function previewDeposit(uint256 assets) public view returns (uint256)",
  "function queueLargeDeposit() external",
  "function maxDeposit(address receiver) public view returns (uint256)",
  "function totalAssets() external view returns (uint256)"
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

export function DepositSection() {
  const [amount, setAmount] = useState("")
  const [isApproving, setIsApproving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { vaultData, refreshVaultData } = useVault()
  const { usdcBalance, isConnected, provider, address } = useWallet()

  // Addresses from environment variables
  const diamondAddress = process.env.NEXT_PUBLIC_DIAMOND_ADDRESS;
  const usdcAddress = process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS;

  const handleDeposit = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return
    
    if (!isConnected || !provider) {
      toast.error("Wallet not connected", {
        description: "Please connect your wallet first"
      });
      return;
    }

    setIsLoading(true);
    const amountNum = Number.parseFloat(amount);
    const amountWei = ethers.parseUnits(amountNum.toString(), 6); // USDC has 6 decimals
    
    try {
      // Initialize contracts with ethers v6
      const signer = await provider.getSigner();

      if (!diamondAddress || !usdcAddress) {
        console.error("Contract addresses not found in environment variables");
        toast.error("Configuration Error", {
          description: "Contract addresses are not properly configured."
        });
        return;
      }

      const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
      const diamondContract = new ethers.Contract(diamondAddress, DIAMOND_ABI, signer);

      // Step 1: Check if user has enough balance
      const actualBalance = await usdcContract.balanceOf(address);
      if (ethers.getBigInt(actualBalance) < ethers.getBigInt(amountWei)) {
        toast.error("Insufficient balance", {
          description: "You don't have enough USDC for this deposit"
        });
        setIsLoading(false);
        return;
      }

      // Step 2: Check vault deposit limit
      const maxDepositAmount = await diamondContract.maxDeposit(address);
      if (ethers.getBigInt(maxDepositAmount) < ethers.getBigInt(amountWei)) {
        toast.error("Deposit limit exceeded", {
          description: `Maximum deposit allowed: ${ethers.formatUnits(maxDepositAmount, 6)} USDC`
        });
        setIsLoading(false);
        return;
      }

      // Step 3: Check if deposit is large (>10% of vault)
      const totalAssets = await diamondContract.totalAssets();
      const isFirstDeposit = ethers.getBigInt(totalAssets) === BigInt(0);
      const isLargeDeposit = !isFirstDeposit && 
        ethers.getBigInt(amountWei) > ethers.getBigInt(totalAssets) / BigInt(10);
      
      if (isLargeDeposit) {
        toast.info("Large deposit detected", {
          description: "This deposit is >10% of the vault. A timelock will be required."
        });
        
        try {
          // Queue the large deposit (will revert if already queued)
          const queueTx = await diamondContract.queueLargeDeposit();
          toast.info("Deposit queued", {
            description: "Please wait 1 hour before completing your deposit"
          });
          await queueTx.wait();
          setIsLoading(false);
          return;
        } catch (error: any) {
          if (error.message && error.message.includes("DepositAlreadyQueued")) {
            toast.info("Deposit already queued", {
              description: "Proceeding with deposit if timelock has passed"
            });
            // Continue with deposit as it may be already unlocked
          } else {
            throw error;
          }
        }
      }
      
      // Step 4: Approve USDC spending if needed
      setIsApproving(true);
      const currentAllowance = await usdcContract.allowance(address, diamondAddress);
      if (ethers.getBigInt(currentAllowance) < ethers.getBigInt(amountWei)) {
        toast.info("Approving USDC...");
        const approveTx = await usdcContract.approve(diamondAddress, amountWei);
        await approveTx.wait();
        toast.success("USDC approved");
      }
      setIsApproving(false);
      
      // Step 5: Execute the deposit
      const expectedShares = await diamondContract.previewDeposit(amountWei);
      
      const feeData = await provider.getFeeData();
      
      toast.info("Depositing USDC...");
      const tx = await diamondContract.deposit(amountWei, address, {
        gasLimit: BigInt(1000000), // Higher limit for complex operation
        maxFeePerGas: feeData.maxFeePerGas, 
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      });
      
      toast.promise(tx.wait(1), {
        loading: 'Confirming transaction...',
        success: 'Deposit successful!',
        error: 'Transaction failed'
      });
      
      await tx.wait(1);
      setAmount("");
      
      // Refresh UI data
      refreshVaultData();
      
    } catch (error: any) {
      console.error("Deposit failed:", error);
      let errorMessage = "Unknown error occurred";
      
      // Extract relevant error messages
      if (error.message) {
        if (error.message.includes("LargeDepositNotTimelocked")) {
          errorMessage = "Timelock period for large deposit has not passed yet";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient ETH for gas fees";
        } else {
          errorMessage = error.message.split('(')[0].trim();
        }
      }
      
      toast.error("Deposit failed", { description: errorMessage });
    } finally {
      setIsApproving(false);
      setIsLoading(false);
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