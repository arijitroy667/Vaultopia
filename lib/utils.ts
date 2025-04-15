import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | string | bigint, decimals: number = 6): string {
  // Convert to number if it's not already
  const numValue = typeof value !== 'number' ? Number(value) / Math.pow(10, decimals) : value;

  // Check if it's a valid number
  if (isNaN(numValue)) return '0.00';
  
  // Format the number with commas and fixed decimal places
  return numValue.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });
}