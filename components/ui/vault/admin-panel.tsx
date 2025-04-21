// "use client"

// import { useState } from "react"
// import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
// import { Input } from "@/components/ui/input"
// import { Button } from "@/components/ui/button"
// import { Switch } from "@/components/ui/switch"
// import { Label } from "@/components/ui/label"
// import { useVault } from "@/context/vault-context"
// import { AlertCircle, Lock } from "lucide-react"
// import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// export function AdminPanel() {
//   const [newFee, setNewFee] = useState("")
//   const [isPaused, setIsPaused] = useState(false)
//   const [isLoading, setIsLoading] = useState(false)
//   const { setFee, togglePause, vaultData } = useVault()

//   const handleSetFee = async () => {
//     if (!newFee || Number.parseFloat(newFee) < 0 || Number.parseFloat(newFee) > 100) return

//     setIsLoading(true)
//     try {
//       await setFee(Number.parseFloat(newFee))
//       setNewFee("")
//     } catch (error) {
//       console.error("Setting fee failed:", error)
//     } finally {
//       setIsLoading(false)
//     }
//   }

//   const handleTogglePause = async () => {
//     setIsLoading(true)
//     try {
//       await togglePause(!isPaused)
//       setIsPaused(!isPaused)
//     } catch (error) {
//       console.error("Toggle pause failed:", error)
//     } finally {
//       setIsLoading(false)
//     }
//   }

//   return (
//     <div className="grid gap-6 md:grid-cols-2">
//       <Card>
//         <CardHeader>
//           <CardTitle>Fee Management</CardTitle>
//           <CardDescription>Set the performance fee for the vault</CardDescription>
//         </CardHeader>
//         <CardContent>
//           <div className="space-y-4">
//             <div className="space-y-2">
//               <label
//                 htmlFor="fee-amount"
//                 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
//               >
//                 Performance Fee (%)
//               </label>
//               <div className="flex space-x-2">
//                 <Input
//                   id="fee-amount"
//                   type="number"
//                   placeholder="0.0"
//                   value={newFee}
//                   onChange={(e) => setNewFee(e.target.value)}
//                   min="0"
//                   max="100"
//                 />
//                 <Button variant="outline" size="sm" onClick={() => setNewFee(vaultData.currentFee.toString())}>
//                   Current: {vaultData.currentFee}%
//                 </Button>
//               </div>
//             </div>
//           </div>
//         </CardContent>
//         <CardFooter>
//           <Button
//             className="w-full"
//             onClick={handleSetFee}
//             disabled={isLoading || !newFee || Number.parseFloat(newFee) < 0 || Number.parseFloat(newFee) > 100}
//           >
//             {isLoading ? "Processing..." : "Set Fee"}
//           </Button>
//         </CardFooter>
//       </Card>

//       <Card>
//         <CardHeader>
//           <CardTitle>Emergency Controls</CardTitle>
//           <CardDescription>Pause deposits and withdrawals</CardDescription>
//         </CardHeader>
//         <CardContent>
//           <Alert variant="destructive" className="mb-4">
//             <AlertCircle className="h-4 w-4" />
//             <AlertTitle>Warning</AlertTitle>
//             <AlertDescription>
//               Pausing the vault will prevent all deposits and withdrawals. Use only in emergency situations.
//             </AlertDescription>
//           </Alert>

//           <div className="flex items-center space-x-2">
//             <Switch id="pause-vault" checked={isPaused} onCheckedChange={setIsPaused} />
//             <Label htmlFor="pause-vault" className="font-medium">
//               {isPaused ? "Vault is paused" : "Vault is active"}
//             </Label>
//           </div>
//         </CardContent>
//         <CardFooter>
//           <Button variant="destructive" className="w-full" onClick={handleTogglePause} disabled={isLoading}>
//             <Lock className="mr-2 h-4 w-4" />
//             {isLoading ? "Processing..." : isPaused ? "Resume Vault" : "Pause Vault"}
//           </Button>
//         </CardFooter>
//       </Card>
//     </div>
//   )
// }

"use client"

import { useState,useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useVault } from "@/context/vault-context"
import { AlertCircle, Lock, Settings, Banknote, RefreshCw, RotateCw, Zap } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"

export function AdminPanel() {
  // States for various admin settings
  const [newFee, setNewFee] = useState("")
  const [isPaused, setIsPaused] = useState(false)
  const [isEmergencyShutdown, setIsEmergencyShutdown] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Contract address states
  const [lidoWithdrawalAddress, setLidoWithdrawalAddress] = useState("")
  const [wstETHAddress, setWstETHAddress] = useState("")
  const [receiverContractAddress, setReceiverContractAddress] = useState("")
  const [swapContractAddress, setSwapContractAddress] = useState("")
  const [feeCollectorAddress, setFeeCollectorAddress] = useState("")
  
  // WstETH balance update state
  const [userAddress, setUserAddress] = useState("")
  const [wstETHAmount, setWstETHAmount] = useState("")

  // Get vault context functions
  const { 
    vaultData, 
    setFee, 
    togglePause, 
    setLidoWithdrawalAddress: updateLidoAddress,
    setWstETHAddress: updateWstETHAddress,
    setReceiverContract: updateReceiverContract,
    setSwapContract: updateSwapContract,
    setFeeCollector: updateFeeCollector,
    toggleEmergencyShutdown,
    collectAccumulatedFees,
    updateWstETHBalance,
    triggerDailyUpdate,
  } = useVault()

  // Fee management handler
  const handleSetFee = async () => {
    if (!newFee || Number.parseFloat(newFee) < 0 || Number.parseFloat(newFee) > 100) return

    setIsLoading(true)
    try {
      await setFee(Number.parseFloat(newFee))
      setNewFee("")
    } catch (error) {
      console.error("Setting fee failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Pause/unpause handler
  const handleTogglePause = async () => {
    setIsLoading(true)
    try {
      await togglePause(!isPaused)
      setIsPaused(!isPaused)
    } catch (error) {
      console.error("Toggle pause failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Emergency shutdown handler
  const handleEmergencyShutdown = async () => {
    setIsLoading(true)
    try {
      await toggleEmergencyShutdown()
      setIsEmergencyShutdown(!isEmergencyShutdown)
    } catch (error) {
      console.error("Emergency shutdown failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Contract address update handlers
  const handleUpdateLidoAddress = async () => {
    if (!lidoWithdrawalAddress || !lidoWithdrawalAddress.startsWith("0x")) return
    setIsLoading(true)
    try {
      await updateLidoAddress(lidoWithdrawalAddress)
    } catch (error) {
      console.error("Updating Lido withdrawal address failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateWstETHAddress = async () => {
    if (!wstETHAddress || !wstETHAddress.startsWith("0x")) return
    setIsLoading(true)
    try {
      await updateWstETHAddress(wstETHAddress)
    } catch (error) {
      console.error("Updating wstETH address failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateReceiverContract = async () => {
    if (!receiverContractAddress || !receiverContractAddress.startsWith("0x")) return
    setIsLoading(true)
    try {
      await updateReceiverContract(receiverContractAddress)
    } catch (error) {
      console.error("Updating receiver contract address failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateSwapContract = async () => {
    if (!swapContractAddress || !swapContractAddress.startsWith("0x")) return
    setIsLoading(true)
    try {
      await updateSwapContract(swapContractAddress)
    } catch (error) {
      console.error("Updating swap contract address failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateFeeCollector = async () => {
    if (!feeCollectorAddress || !feeCollectorAddress.startsWith("0x")) return
    setIsLoading(true)
    try {
      await updateFeeCollector(feeCollectorAddress)
    } catch (error) {
      console.error("Updating fee collector address failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // WstETH balance update handler
  const handleUpdateWstETHBalance = async () => {
    if (!userAddress || !userAddress.startsWith("0x") || !wstETHAmount) return
    setIsLoading(true)
    try {
      await updateWstETHBalance(userAddress, parseFloat(wstETHAmount))
    } catch (error) {
      console.error("Updating WstETH balance failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Daily update handler
  const handleTriggerDailyUpdate = async () => {
    setIsLoading(true)
    try {
      await triggerDailyUpdate()
    } catch (error) {
      console.error("Triggering daily update failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Collect fees handler
  const handleCollectFees = async () => {
    setIsLoading(true)
    try {
      await collectAccumulatedFees()
    } catch (error) {
      console.error("Collecting fees failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Vault Administration</h2>
      
      <Tabs defaultValue="emergency" className="w-full">
        <TabsList className="grid grid-cols-4 mb-4">
          <TabsTrigger value="emergency">Emergency Controls</TabsTrigger>
          <TabsTrigger value="fees">Fee Management</TabsTrigger>
          <TabsTrigger value="contracts">Contract Configuration</TabsTrigger>
          <TabsTrigger value="maintenance">System Maintenance</TabsTrigger>
        </TabsList>

        {/* Emergency Controls Tab */}
        <TabsContent value="emergency" className="space-y-4">
          <Card className="border-red-200">
            <CardHeader className="bg-red-50/50 dark:bg-red-900/10">
              <CardTitle className="flex items-center">
                <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
                Emergency Controls
              </CardTitle>
              <CardDescription>Critical vault operation controls</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Warning</AlertTitle>
                <AlertDescription>
                  These controls affect the entire vault and all users. Use with extreme caution.
                </AlertDescription>
              </Alert>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Deposit Controls</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="pause-deposits" className="font-medium">
                        {isPaused ? "Deposits are paused" : "Deposits are active"}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Toggle users' ability to make new deposits
                      </p>
                    </div>
                    <Switch id="pause-deposits" checked={isPaused} onCheckedChange={setIsPaused} />
                  </div>
                  <Button 
                    variant={isPaused ? "outline" : "destructive"} 
                    className="w-full mt-2"
                    onClick={handleTogglePause} 
                    disabled={isLoading}
                  >
                    <Lock className="mr-2 h-4 w-4" />
                    {isLoading ? "Processing..." : isPaused ? "Resume Deposits" : "Pause Deposits"}
                  </Button>
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-medium mb-2">Emergency Shutdown</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="emergency-shutdown" className="font-medium">
                        {isEmergencyShutdown ? "Emergency mode activated" : "Normal operations"}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Halt all vault operations in case of emergency
                      </p>
                    </div>
                    <Switch 
                      id="emergency-shutdown" 
                      checked={isEmergencyShutdown} 
                      onCheckedChange={setIsEmergencyShutdown} 
                    />
                  </div>
                  <Button 
                    variant={isEmergencyShutdown ? "outline" : "destructive"} 
                    className="w-full mt-2"
                    onClick={handleEmergencyShutdown} 
                    disabled={isLoading}
                  >
                    <Zap className="mr-2 h-4 w-4" />
                    {isLoading ? "Processing..." : isEmergencyShutdown 
                      ? "Disable Emergency Mode" 
                      : "Activate Emergency Shutdown"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fee Management Tab */}
        <TabsContent value="fees" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Performance Fee</CardTitle>
                <CardDescription>Set the performance fee for the vault</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="fee-amount">Performance Fee (%)</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="fee-amount"
                      type="number"
                      placeholder="0.0"
                      value={newFee}
                      onChange={(e) => setNewFee(e.target.value)}
                      min="0"
                      max="100"
                    />
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setNewFee((vaultData?.currentFee || 0).toString())}
                    >
                      Current: {vaultData?.currentFee || 0}%
                    </Button>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={handleSetFee}
                  disabled={isLoading || !newFee || Number.parseFloat(newFee) < 0 || Number.parseFloat(newFee) > 100}
                >
                  {isLoading ? "Processing..." : "Set Fee"}
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fee Collection</CardTitle>
                <CardDescription>Collect accumulated performance fees</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-muted p-4 rounded-md">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Accumulated Fees:</span>
                      <span className="font-bold">${vaultData?.accumulatedFees || "0.00"}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="fee-collector">Fee Collector Address</Label>
                    <Input
                      id="fee-collector"
                      placeholder="0x..."
                      value={feeCollectorAddress}
                      onChange={(e) => setFeeCollectorAddress(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-2">
                <Button
                  className="w-full"
                  onClick={handleUpdateFeeCollector}
                  disabled={isLoading || !feeCollectorAddress || !feeCollectorAddress.startsWith("0x")}
                >
                  Set Fee Collector
                </Button>
                <Button
                  className="w-full"
                  variant="default"
                  onClick={handleCollectFees}
                  disabled={isLoading || !((vaultData?.accumulatedFees ?? 0) > 0)}
                >
                  <Banknote className="mr-2 h-4 w-4" />
                  Collect Fees
                </Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>

        {/* Contract Configuration Tab */}
        <TabsContent value="contracts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contract Addresses</CardTitle>
              <CardDescription>Configure integration contract addresses</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lido-withdrawal">Lido Withdrawal Address</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="lido-withdrawal"
                      placeholder="0x..."
                      value={lidoWithdrawalAddress}
                      onChange={(e) => setLidoWithdrawalAddress(e.target.value)}
                    />
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleUpdateLidoAddress}
                      disabled={isLoading || !lidoWithdrawalAddress || !lidoWithdrawalAddress.startsWith("0x")}
                    >
                      Update
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wsteth-address">wstETH Address</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="wsteth-address"
                      placeholder="0x..."
                      value={wstETHAddress}
                      onChange={(e) => setWstETHAddress(e.target.value)}
                    />
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleUpdateWstETHAddress}
                      disabled={isLoading || !wstETHAddress || !wstETHAddress.startsWith("0x")}
                    >
                      Update
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="receiver-contract">Receiver Contract</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="receiver-contract"
                      placeholder="0x..."
                      value={receiverContractAddress}
                      onChange={(e) => setReceiverContractAddress(e.target.value)}
                    />
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleUpdateReceiverContract}
                      disabled={isLoading || !receiverContractAddress || !receiverContractAddress.startsWith("0x")}
                    >
                      Update
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="swap-contract">Swap Contract</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="swap-contract"
                      placeholder="0x..."
                      value={swapContractAddress}
                      onChange={(e) => setSwapContractAddress(e.target.value)}
                    />
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleUpdateSwapContract}
                      disabled={isLoading || !swapContractAddress || !swapContractAddress.startsWith("0x")}
                    >
                      Update
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Daily Update</CardTitle>
                <CardDescription>Manage scheduled system updates</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="bg-muted p-4 rounded-md">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Last Update:</span>
                      <span>
                        {vaultData?.lastDailyUpdate 
                          ? new Date(vaultData.lastDailyUpdate * 1000).toLocaleString() 
                          : "Never"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-sm font-medium">Next Update Available:</span>
                      <span>
                        {vaultData?.lastDailyUpdate 
                          ? new Date((vaultData.lastDailyUpdate + 86400) * 1000).toLocaleString() 
                          : "Immediately"}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={handleTriggerDailyUpdate}
                  disabled={isLoading}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {isLoading ? "Processing..." : "Trigger Daily Update"}
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Balance Management</CardTitle>
                <CardDescription>Update wstETH balance for a user</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="user-address">User Address</Label>
                    <Input
                      id="user-address"
                      placeholder="0x..."
                      value={userAddress}
                      onChange={(e) => setUserAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wsteth-amount">wstETH Amount</Label>
                    <Input
                      id="wsteth-amount"
                      type="number"
                      placeholder="0.0"
                      value={wstETHAmount}
                      onChange={(e) => setWstETHAmount(e.target.value)}
                      min="0"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={handleUpdateWstETHBalance}
                  disabled={isLoading || !userAddress || !wstETHAmount || parseFloat(wstETHAmount) <= 0}
                >
                  <RotateCw className="mr-2 h-4 w-4" />
                  Update wstETH Balance
                </Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}