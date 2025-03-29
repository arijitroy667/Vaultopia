import {
  LidoSDK,
  TransactionCallback,
  TransactionCallbackStage,
  SDKError,
} from '@lidofinance/lido-ethereum-sdk';
import { createPublicClient, createWalletClient, http, Address, encodeFunctionData } from 'viem';
import { holesky } from 'viem/chains';
import { custom } from 'viem';
import Web3Provider from './web3Provider';
import { ethers } from "ethers";


const LIDO_ADDRESSES = {
  LIDO_STETH: {
      holesky: '0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034',
      mainnet: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
  },
  WRAPPED_STETH: {
      holesky: '0x2aE7Dc0A3B998072f29C3648D616B14D11ab17cA',
      mainnet: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
  }
} as const;

// Receiver contract ABI (simplified for the functions we need)
const RECEIVER_ABI = [
  {
      inputs: [],
      name: "_stakeWithLido",
      outputs: [{ name: "",type: "uint256" }],
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
];

const ERRORS = {
  NO_ETH: 'No ETH sent',
  LIDO_NOT_SET: 'Lido contract not set',
  WSTETH_NOT_SET: 'wstETH contract not set',
  STETH_NOT_RECEIVED: 'stETH not received',
  APPROVAL_FAILED: 'stETH approval failed',
  NO_WSTETH: 'No wstETH received'
} as const;

// Configuration
const RECEIVER_ADDRESS = '0xYourReceiverContractAddress' as Address;
const ACCOUNT_ADDRESS = '0x9aD95Ef94D945B039eD5E8059603119b61271486' as Address;

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

// Transaction callback
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

// Function to stake ETH directly with Lido
async function stakeWithLido(amount: bigint) {
  try {
    console.log(`Staking ${ethers.formatEther(amount.toString())} ETH with Lido...`);
    
    const txHash = await walletClient.sendTransaction({
      to: RECEIVER_ADDRESS,
      value: amount,
      account: ACCOUNT_ADDRESS,
      data: encodeFunctionData({
        abi: RECEIVER_ABI,
        functionName: '_stakeWithLido'
      })
    });
    
    // Wait for transaction receipt
    const receipt = await rpcProvider.waitForTransactionReceipt({ hash: txHash });
    
    // Log transaction details
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
// Function to trigger staking on the Receiver contract (for ETH already in the contract)
async function triggerReceiverStaking() {
  try {
    console.log('Triggering staking on Receiver contract...');
    
    const calldata = encodeFunctionData({
      abi: RECEIVER_ABI,
      functionName: '_stakeWithLido',
    });
    
    const hash = await walletClient.sendTransaction({
      to: RECEIVER_ADDRESS,
      data: calldata,
      account: ACCOUNT_ADDRESS,
    });
    
    console.log('Successfully triggered staking, transaction hash:', hash);
    return hash;
  } catch (error) {
    console.error('Failed to trigger staking:', error);
    throw error;
  }
}

// Function to withdraw stETH from Lido
// Function to withdraw stETH from Lido
async function withdrawFromLido(stethAmount: bigint) {
  try {
    console.log(`Requesting withdrawal of ${ethers.formatEther(stethAmount.toString())} stETH...`);
    
    const withdrawalTx = await lidoSDK.withdrawals.requestWithdrawals({
      amounts: [stethAmount],
      callback,
      account: ACCOUNT_ADDRESS,
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

// Function to claim ETH after withdrawal request is finalized
async function claimWithdrawal(requestId: bigint) {
  try {
    console.log(`Claiming ETH for request ID: ${requestId}...`);
    
    const claimTx = await lidoSDK.withdraw.claim({
      requestId,
      callback,
      account: ACCOUNT_ADDRESS,
    });
    
    console.log('Claim successful:');
    console.log('- TX Hash:', claimTx.hash);
    console.log('- ETH Claimed:', claimTx.result.amountOfETH);
    
    // After claiming, trigger sendETHToSwap to move the ETH to swap contract
    await sendETHToSwap();
    
    return claimTx;
  } catch (error) {
    const sdkError = error as SDKError;
    console.error('Claim failed:', sdkError.errorMessage, sdkError.code);
    throw error;
  }
}

// Function to send ETH from Receiver to Swap contract
async function sendETHToSwap() {
  try {
    console.log('Sending ETH from Receiver to Swap contract...');
    
    const calldata = encodeFunctionData({
      abi: RECEIVER_ABI,
      functionName: 'sendETHToSwap',
    });
    
    const hash = await walletClient.sendTransaction({
      to: RECEIVER_ADDRESS,
      data: calldata,
      account: ACCOUNT_ADDRESS,
    });
    
    console.log('Successfully sent ETH to Swap contract, transaction hash:', hash);
    return hash;
  } catch (error) {
    console.error('Failed to send ETH to Swap:', error);
    throw error;
  }
}

// Main function to handle automated flow
async function automatedLidoFlow(action: 'stake' | 'withdraw' | 'claim', options: any = {}) {
  try {
    switch (action) {
      case 'stake':
        if (options.directStake) {
          // Direct staking with amount
          return await stakeWithLido(BigInt(options.amount || '1000000000000000000'));
        } else {
          // Trigger staking of ETH already in Receiver contract
          return await triggerReceiverStaking();
        }
      
      case 'withdraw':
        // Withdraw stETH
        return await withdrawFromLido(BigInt(options.amount || '1000000000000000000'));
      
      case 'claim':
        // Claim ETH and send to swap
        return await claimWithdrawal(BigInt(options.requestId));
      
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
  sendETHToSwap
};

// Example usage
// automatedLidoFlow('stake'); // Trigger staking on Receiver
// automatedLidoFlow('stake', { directStake: true, amount: '2000000000000000000' }); // Stake 2 ETH directly
// automatedLidoFlow('withdraw', { amount: '1000000000000000000' }); // Withdraw 1 stETH
// automatedLidoFlow('claim', { requestId: '123456' }); // Claim ETH for request ID 123456