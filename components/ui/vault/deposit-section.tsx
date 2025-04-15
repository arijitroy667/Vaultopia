// "use client"

// import { useState } from "react"
// import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
// import { Input } from "@/components/ui/input"
// import { Button } from "@/components/ui/button"
// import { useVault } from "@/context/vault-context"
// import { useWallet } from "@/context/wallet-context"
// import { ArrowRight, Info } from "lucide-react"
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
// import {checkUSDCBalance,
//   checkVaultBalance,
//   checkMaxDeposit,
//   approveUSDC,
//   queueLargeDeposit,
//   previewDeposit,
//   deposit,
//   main} from "../../../Vault_forge/src/Integrate/Deposit"

//   export function DepositSection() {
//   const [amount, setAmount] = useState("")
//   const [isLoading, setIsLoading] = useState(false)
//   const { deposit, vaultData } = useVault()
//   const { balance } = useWallet()

//   const diamondAddress=process.env.YIELDBULL_CONTRACT_ADDRESS;
//   const usdcAddress=process.env.USDC_CONTRACT_ADDRESS;

//   const handleDeposit = async () => {
//     if (!amount || Number.parseFloat(amount) <= 0) return

//     setIsLoading(true)
//     try {
//       await deposit(diamondAddress, usdcAddress, amount, receiver)
//       setAmount("")
//     } catch (error) {
//       console.error("Deposit failed:", error)
//     } finally {
//       setIsLoading(false)
//     }
//   }

//   const estimatedShares = amount ? Number.parseFloat(amount) / vaultData.exchangeRate : 0

//   return (
//     <Card>
//       <CardHeader>
//         <CardTitle>Deposit & Mint Shares</CardTitle>
//         <CardDescription>Deposit tokens and receive vault shares</CardDescription>
//       </CardHeader>
//       <CardContent>
//         <div className="space-y-4">
//           <div className="space-y-2">
//             <div className="flex items-center justify-between">
//               <label
//                 htmlFor="deposit-amount"
//                 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
//               >
//                 Amount to Deposit
//               </label>
//               <span className="text-xs text-muted-foreground">Balance: {balance} ETH</span>
//             </div>
//             <div className="flex space-x-2">
//               <Input
//                 id="deposit-amount"
//                 type="number"
//                 placeholder="0.0"
//                 value={amount}
//                 onChange={(e) => setAmount(e.target.value)}
//               />
//               <Button variant="outline" size="sm" onClick={() => setAmount(balance.toString())}>
//                 Max
//               </Button>
//             </div>
//           </div>

//           <div className="rounded-lg bg-muted p-4">
//             <div className="flex items-center justify-between text-sm">
//               <div className="flex items-center">
//                 <span>Estimated Shares</span>
//                 <TooltipProvider>
//                   <Tooltip>
//                     <TooltipTrigger asChild>
//                       <Info className="h-3 w-3 ml-1 text-muted-foreground" />
//                     </TooltipTrigger>
//                     <TooltipContent>
//                       <p>Shares represent your ownership in the vault</p>
//                     </TooltipContent>
//                   </Tooltip>
//                 </TooltipProvider>
//               </div>
//               <span className="font-medium">{estimatedShares.toFixed(6)}</span>
//             </div>
//             <div className="mt-2 flex items-center justify-between text-sm">
//               <span>Exchange Rate</span>
//               <span className="font-medium">1 Share = ${vaultData.exchangeRate}</span>
//             </div>
//           </div>
//         </div>
//       </CardContent>
//       <CardFooter>
//         <Button
//           className="w-full"
//           onClick={handleDeposit}
//           disabled={isLoading || !amount || Number.parseFloat(amount) <= 0 || Number.parseFloat(amount) > balance}
//         >
//           {isLoading ? "Processing..." : "Deposit"}
//           {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
//         </Button>
//       </CardFooter>
//     </Card>
//   )
// }

// components/ui/vault/deposit-section.tsx
"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useVault } from "@/context/vault-context"
import { useWallet } from "@/context/wallet-context"
import { ArrowRight, Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function DepositSection() {
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { deposit, vaultData } = useVault()
  const { usdcBalance, isConnected } = useWallet()

  const handleDeposit = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return
    if (!isConnected) {
      toast.error("Wallet not connected", {
        description: "Please connect your wallet first"
      });
      return;
    }

    const amountNum = Number.parseFloat(amount);
    setIsLoading(true);
    
    try {
      await deposit(amountNum);
      setAmount("");
    } catch (error) {
      console.error("Deposit failed:", error);
    toast.error("Deposit failed", {
      description: error instanceof Error ? error.message : "Unknown error occurred"
    });
    } finally {
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
        <CardDescription>Deposit tokens and receive vault shares</CardDescription>
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
              />
              <Button variant="outline" size="sm" onClick={() => setAmount(usdcBalance.toString())}>
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
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleDeposit}
          disabled={isLoading || !amount || Number.parseFloat(amount) <= 0 || Number.parseFloat(amount) > usdcBalance}
        >
          {isLoading ? "Processing..." : "Deposit"}
          {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </CardFooter>
    </Card>
  )
}

