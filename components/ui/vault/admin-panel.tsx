"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useVault } from "@/context/vault-context"
import { AlertCircle, Lock } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function AdminPanel() {
  const [newFee, setNewFee] = useState("")
  const [isPaused, setIsPaused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { setFee, togglePause, vaultData } = useVault()

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

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Fee Management</CardTitle>
          <CardDescription>Set the performance fee for the vault</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="fee-amount"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Performance Fee (%)
              </label>
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
                <Button variant="outline" size="sm" onClick={() => setNewFee(vaultData.currentFee.toString())}>
                  Current: {vaultData.currentFee}%
                </Button>
              </div>
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
          <CardTitle>Emergency Controls</CardTitle>
          <CardDescription>Pause deposits and withdrawals</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Pausing the vault will prevent all deposits and withdrawals. Use only in emergency situations.
            </AlertDescription>
          </Alert>

          <div className="flex items-center space-x-2">
            <Switch id="pause-vault" checked={isPaused} onCheckedChange={setIsPaused} />
            <Label htmlFor="pause-vault" className="font-medium">
              {isPaused ? "Vault is paused" : "Vault is active"}
            </Label>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="destructive" className="w-full" onClick={handleTogglePause} disabled={isLoading}>
            <Lock className="mr-2 h-4 w-4" />
            {isLoading ? "Processing..." : isPaused ? "Resume Vault" : "Pause Vault"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

