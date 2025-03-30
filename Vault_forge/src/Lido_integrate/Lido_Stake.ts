import {
  LidoSDK,
  TransactionCallback,
  TransactionCallbackStage,
  SDKError,
} from '@lidofinance/lido-ethereum-sdk';
import { createPublicClient, createWalletClient, http, Address, encodeFunctionData, parseEther } from 'viem';
import { holesky } from 'viem/chains';
import { custom } from 'viem';
import Web3Provider from './web3Provider';
import { ethers } from "ethers";

const ADDRESSES = {
  VAULT: '0xYourVaultContractAddress' as Address,
  RECEIVER: '0xYourReceiverContractAddress' as Address,
  SWAP: '0xYourSwapContractAddress' as Address,
  LIDO_STETH: {
    holesky: '0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034',
    mainnet: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
  },
  WRAPPED_STETH: {
    holesky: '0x2aE7Dc0A3B998072f29C3648D616B14D11ab17cA',
    mainnet: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
  }
} as const;

// ABIs for contract interactions
const RECEIVER_ABI = [
  {
    inputs: [],
    name: "_stakeWithLido",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "sendETHToSwap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

const VAULT_ABI = [
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "minUSDCExpected", type: "uint256" }
    ],
    name: "processCompletedWithdrawals",
    outputs: [
      { name: "sharesMinted", type: "uint256" },
      { name: "usdcReceived", type: "uint256" }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "beneficiary", type: "address" }
    ],
    name: "safeTransferAndSwap",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

// Error constants
const ERRORS = {
  NO_ETH: 'No ETH sent',
  LIDO_NOT_SET: 'Lido contract not set',
  WSTETH_NOT_SET: 'wstETH contract not set',
  STETH_NOT_RECEIVED: 'stETH not received',
  APPROVAL_FAILED: 'stETH approval failed',
  NO_WSTETH: 'No wstETH received',
  WITHDRAWAL_NOT_READY: 'Withdrawal not ready',
  NO_WITHDRAWAL: 'No withdrawal in progress'
} as const;

// Set up providers
const rpcProvider = createPublicClient({
  chain: holesky,
  transport: http("https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs"),
});

const walletClient = createWalletClient({
  chain: holesky,
  transport: custom(Web3Provider)
});

// Initialize Lido SDK
const lidoSDK = new LidoSDK({
  chainId: 17000,
  rpcProvider,
  web3Provider: walletClient,
});

// Transaction callback for logging
const callback: TransactionCallback = ({ stage, payload }) => {
  switch (stage) {
    case TransactionCallbackStage.SIGN:
      console.log('⏳ Waiting for signature...');
      break;
    case TransactionCallbackStage.RECEIPT:
      console.log('📝 Transaction submitted:', payload);
      break;
    case TransactionCallbackStage.CONFIRMATION:
      console.log('🔄 Waiting for confirmation:', payload);
      break;
    case TransactionCallbackStage.DONE:
      console.log('✅ Transaction confirmed:', payload);
      break;
    case TransactionCallbackStage.ERROR:
      console.log('❌ Error:', payload);
      break;
    default:
  }
};

/**
 * Stakes ETH with Lido through the Receiver contract
 * @param amount Amount of ETH to stake in wei
 * @param accountAddress Address of the account initiating the transaction
 * @returns Transaction details
 */
async function stakeWithLido(amount: bigint, accountAddress: Address = ADDRESSES.RECEIVER) {
  try {
    console.log(`Staking ${ethers.formatEther(amount.toString())} ETH with Lido via Receiver...`);
    
    // Send ETH to Receiver and call _stakeWithLido
    const txHash = await walletClient.sendTransaction({
      to: ADDRESSES.RECEIVER,
      value: amount,
      account: accountAddress,
      data: encodeFunctionData({
        abi: RECEIVER_ABI,
        functionName: '_stakeWithLido'
      })
    });
    
    // Wait for receipt
    const receipt = await rpcProvider.waitForTransactionReceipt({ hash: txHash });
    
    console.log('Staking transaction details:');
    console.log('- Hash:', txHash);
    console.log('- Status:', receipt.status === 'success' ? 'Success' : 'Failed');
    console.log('- Block:', receipt.blockNumber);
    console.log('- Gas used:', receipt.gasUsed);
    
    return {
      hash: txHash,
      receipt,
      status: receipt.status
    };
  } catch (error) {
    console.error('Staking failed:', error);
    throw error;
  }
}

/**
 * Triggers the Receiver contract to stake ETH already in the contract
 * @param accountAddress Address of the account initiating the transaction
 * @returns Transaction hash
 */
async function triggerReceiverStaking(accountAddress: Address) {
  try {
    console.log('Triggering staking on Receiver contract...');
    
    const calldata = encodeFunctionData({
      abi: RECEIVER_ABI,
      functionName: '_stakeWithLido',
    });
    
    const hash = await walletClient.sendTransaction({
      to: ADDRESSES.RECEIVER,
      data: calldata,
      account: accountAddress,
    });
    
    console.log('Successfully triggered staking, transaction hash:', hash);
    return hash;
  } catch (error) {
    console.error('Failed to trigger staking:', error);
    throw error;
  }
}

/**
 * Withdraws stETH from Lido
 * @param stethAmount Amount of stETH to withdraw in wei
 * @param accountAddress Address of the account initiating the transaction 
 * @returns Withdrawal transaction details
 */
async function withdrawFromLido(stethAmount: bigint, accountAddress: Address) {
  try {
    console.log(`Requesting withdrawal of ${ethers.formatEther(stethAmount.toString())} stETH...`);
    
    const withdrawalTx = await lidoSDK.withdraw.requestWithdrawals({
      amounts: [stethAmount],
      callback,
      account: accountAddress,
    });
    
    console.log('Withdrawal request successful:');
    console.log('- TX Hash:', withdrawalTx.hash);
    console.log('- Request IDs:', withdrawalTx.result.requestIds);
    console.log('- Amount of ETH to receive:', withdrawalTx.result.amountOfStETH);
    
    return withdrawalTx;
  } catch (error) {
    const sdkError = error as SDKError;
    console.error('Withdrawal failed:', sdkError.errorMessage, sdkError.code);
    throw error;
  }
}

/**
 * Claims ETH from Lido after withdrawal request is finalized
 * @param requestId Withdrawal request ID
 * @param accountAddress Address of the account initiating the transaction
 * @returns Claim transaction details
 */
async function claimWithdrawal(requestId: bigint, accountAddress: Address) {
  try {
    console.log(`Claiming ETH for request ID: ${requestId}...`);
    
    const claimTx = await lidoSDK.withdraw.claim({
      requestId,
      callback,
      account: accountAddress,
    });
    
    console.log('Claim successful:');
    console.log('- TX Hash:', claimTx.hash);
    console.log('- ETH Claimed:', claimTx.result.amountOfETH);
    
    // After claiming, trigger sendETHToSwap to move the ETH to swap contract
    await sendETHToSwap(accountAddress);
    
    return claimTx;
  } catch (error) {
    const sdkError = error as SDKError;
    console.error('Claim failed:', sdkError.errorMessage, sdkError.code);
    throw error;
  }
}

/**
 * Sends ETH from Receiver to Swap contract
 * @param accountAddress Address of the account initiating the transaction
 * @returns Transaction hash
 */
async function sendETHToSwap(accountAddress: Address) {
  try {
    console.log('Sending ETH from Receiver to Swap contract...');
    
    const calldata = encodeFunctionData({
      abi: RECEIVER_ABI,
      functionName: 'sendETHToSwap',
    });
    
    const hash = await walletClient.sendTransaction({
      to: ADDRESSES.RECEIVER,
      data: calldata,
      account: accountAddress,
    });
    
    console.log('Successfully sent ETH to Swap contract, transaction hash:', hash);
    return hash;
  } catch (error) {
    console.error('Failed to send ETH to Swap:', error);
    throw error;
  }
}

/**
 * Processes completed withdrawals and mints new shares
 * @param userAddress User address for the withdrawal
 * @param minExpectedUSDC Minimum expected USDC from the swap
 * @param accountAddress Address of the account initiating the transaction
 * @returns Transaction details with minted shares and received USDC
 */
async function processWithdrawal(userAddress: Address, minExpectedUSDC: bigint, accountAddress: Address) {
  try {
    console.log(`Processing withdrawal for user: ${userAddress}`);
    
    const calldata = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'processCompletedWithdrawals',
      args: [userAddress, minExpectedUSDC]
    });
    
    const hash = await walletClient.sendTransaction({
      to: ADDRESSES.VAULT,
      data: calldata,
      account: accountAddress,
    });
    
    const receipt = await rpcProvider.waitForTransactionReceipt({ hash });
    
    console.log('Withdrawal processing successful:');
    console.log('- Hash:', hash);
    console.log('- Status:', receipt.status);
    
    return {
      hash,
      receipt,
      status: receipt.status
    };
  } catch (error) {
    console.error('Failed to process withdrawal:', error);
    throw error;
  }
}

/**
 * Initiates the staking process from the Vault
 * @param beneficiary User address to stake for
 * @param minExpectedETH Minimum expected ETH from the USDC swap
 * @param accountAddress Address of the account initiating the transaction
 * @returns Transaction details with wstETH received
 */
async function initiateStaking(beneficiary: Address, minExpectedETH: bigint, accountAddress: Address) {
  try {
    console.log(`Initiating staking for user: ${beneficiary}`);
    
    const calldata = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'safeTransferAndSwap',
      args: [minExpectedETH, beneficiary]
    });
    
    const hash = await walletClient.sendTransaction({
      to: ADDRESSES.VAULT,
      data: calldata,
      account: accountAddress,
    });
    
    const receipt = await rpcProvider.waitForTransactionReceipt({ hash });
    
    console.log('Staking initiation successful:');
    console.log('- Hash:', hash);
    console.log('- Status:', receipt.status);
    
    return {
      hash,
      receipt,
      status: receipt.status
    };
  } catch (error) {
    console.error('Failed to initiate staking:', error);
    throw error;
  }
}

/**
 * Automated flow for different Lido operations
 * @param action Action to perform (stake, withdraw, claim, process)
 * @param options Configuration options for the action
 * @returns Transaction details
 */
async function automatedLidoFlow(action: 'stake' | 'withdraw' | 'claim' | 'process', options: any = {}) {
  try {
    const accountAddress = options.account || options.signer || ADDRESSES.RECEIVER;
    
    switch (action) {
      case 'stake':
        if (options.directStake) {
          // Direct staking with amount
          return await stakeWithLido(
            BigInt(options.amount || parseEther('0.1')),
            accountAddress
          );
        } else if (options.initiateFromVault) {
          // Trigger staking from Vault
          return await initiateStaking(
            options.beneficiary || accountAddress,
            BigInt(options.minExpectedETH || '0'),
            accountAddress
          );
        } else {
          // Trigger staking of ETH already in Receiver contract
          return await triggerReceiverStaking(accountAddress);
        }
      
      case 'withdraw':
        // Withdraw stETH
        return await withdrawFromLido(
          BigInt(options.amount || parseEther('0.1')),
          accountAddress
        );
      
      case 'claim':
        // Claim ETH and send to swap
        return await claimWithdrawal(
          BigInt(options.requestId || '0'),
          accountAddress
        );
      
      case 'process':
        // Process completed withdrawals
        return await processWithdrawal(
          options.user || accountAddress,
          BigInt(options.minUSDCExpected || '0'),
          accountAddress
        );
      
      default:
        throw new Error('Invalid action specified');
    }
  } catch (error) {
    console.error('Automated flow failed:', error);
    throw error;
  }
}

// Export functions for external use
export {
  automatedLidoFlow,
  stakeWithLido,
  triggerReceiverStaking,
  withdrawFromLido,
  claimWithdrawal,
  sendETHToSwap,
  processWithdrawal,
  initiateStaking
};

// Usage examples:
/*
1. Stake ETH directly through Receiver:
   automatedLidoFlow('stake', { directStake: true, amount: '1000000000000000000', account: '0x...' });

2. Trigger staking of ETH already in Receiver:
   automatedLidoFlow('stake', { account: '0x...' });

3. Initiate staking from Vault for a user (40% portion):
   automatedLidoFlow('stake', { initiateFromVault: true, beneficiary: '0x...', account: '0x...' });

4. Request withdrawal from Lido:
   automatedLidoFlow('withdraw', { amount: '1000000000000000000', account: '0x...' });

5. Claim ETH after withdrawal request is finalized:
   automatedLidoFlow('claim', { requestId: '123456', account: '0x...' });

6. Process withdrawal and mint shares:
   automatedLidoFlow('process', { user: '0x...', minUSDCExpected: '1000000', account: '0x...' });
*/