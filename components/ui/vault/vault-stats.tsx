"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVault } from "@/context/vault-context";
import {
  ArrowUpRight,
  TrendingUp,
  Wallet,
  Users,
  BarChart,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function VaultStats() {
  const { vaultData, userShares, isLoading, fetchLidoAPY } = useVault();
  const [localLoading, setLocalLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      console.log("Debug VaultStats values:", {
        totalShares: vaultData.totalShares,
        userShares,
        exchangeRate: vaultData.exchangeRate,
        rawTVL: vaultData.tvl,
        calculatedValue: userShares * vaultData.exchangeRate,
      });
    }
  }, [isLoading, vaultData, userShares]);

  const refreshAPY = async () => {
    try {
      setLocalLoading(true);
      await fetchLidoAPY();
      toast.success("APY data refreshed from Lido");
    } catch (error) {
      toast.error("Failed to refresh APY data");
    } finally {
      setLocalLoading(false);
    }
  };

  // Format numbers with 2 decimal places
  const formatCurrency = (value) => {
    if (value === undefined || value === null || isNaN(value)) return "0.00";
    return parseFloat(value.toFixed(2)).toLocaleString();
  };

  function formatShares(shares) {
    console.log("Formatting share value:", shares); // Debug logging

    if (shares === undefined || shares === null || shares === 0)
      return "No shares";

    // Handle very small values that might appear as zero
    if (shares < 0.0000001) return shares.toExponential(8);
    if (shares < 0.000001) return shares.toExponential(6);
    if (shares < 0.001) return shares.toFixed(6);
    if (shares < 1) return shares.toFixed(4);
    return parseFloat(shares.toFixed(2)).toLocaleString();
  }

  function formatExchangeRate(rate) {
    if (rate === undefined || rate === null || isNaN(rate)) return "1.00";
    if (rate > 10000) return "1.00"; // Cap unreasonable values
    return parseFloat(rate.toFixed(4)).toLocaleString();
  }

  function calculateShareValue(shares, exchangeRate) {
    // Use a safe exchange rate (capped at 10000 like in formatExchangeRate)
    const safeRate = exchangeRate > 10000 ? 1.0 : exchangeRate;

    if (shares === 0) return "0.00";

    const value = shares * safeRate;

    // Format the value appropriately
    if (value < 0.01) return value.toFixed(6);
    if (value < 1) return value.toFixed(4);
    return value.toFixed(2);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* TVL Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Total Value Locked
          </CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">
                ${formatCurrency(vaultData?.tvl || 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                <span
                  className={`flex items-center ${
                    (vaultData?.tvlChange || 0) >= 0
                      ? "text-green-500"
                      : "text-red-500"
                  }`}
                >
                  {(vaultData?.tvlChange || 0) >= 0 ? "+" : ""}
                  {formatCurrency(vaultData?.tvlChange || 0)}%
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Original APY Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">APY</CardTitle>

          <div className="flex items-center">
            <button
              onClick={refreshAPY}
              className="mr-2 opacity-70 hover:opacity-100 transition-opacity"
              disabled={localLoading}
            >
              <RefreshCw
                className={`h-3 w-3 text-muted-foreground ${
                  localLoading ? "animate-spin" : ""
                }`}
              />
            </button>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">
                {formatCurrency(vaultData?.apy || 0)}%
                <span className="ml-2 text-xs text-cyan-500 font-normal">
                  (Lido + 2%)
                </span>
              </div>
              <div className="flex items-center text-xs text-muted-foreground">
                <img
                  src="/lido-logo.png"
                  alt="Lido"
                  className="h-4 w-3 mr-1"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
                Based on last 7-day moving average
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Total Shares Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Shares</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">
                {formatShares(vaultData.totalShares)}
              </div>
              <p className="text-xs text-muted-foreground">
                Exchange Rate: ${formatExchangeRate(vaultData.exchangeRate)}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Your Shares Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Your Shares</CardTitle>
          <BarChart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">
                {formatShares(userShares)}
              </div>
              <p className="text-xs text-muted-foreground">
                Value: $
                {calculateShareValue(userShares, vaultData.exchangeRate)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
