import {
    LidoSDK,
    LidoSDKCore,
    TransactionCallback,
    TransactionCallbackStage,
    SDKError,
  } from '@lidofinance/lido-ethereum-sdk';
  import { createPublicClient, createWalletClient, http, Address, PublicClient, encodeFunctionData } from 'viem';
  import { holesky } from 'viem/chains';
  import { custom } from 'viem';
  import vaultProvider from './web3Provider';
  import { ethers } from "ethers";

  // Set up your providers
  const rpcProvider = createPublicClient({
    chain: holesky,
    transport: http("https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs"),
  });
  
  // Initialize the Lido SDK with your custom vault provider
  const walletClient = createWalletClient({
    chain: holesky,
    transport: custom(vaultProvider)
  });
  
  const lidoSDK = new LidoSDK({
    chainId: 17000,
    rpcProvider,
    web3Provider: walletClient, // Make sure this matches what Lido SDK expects
  });
  
 const callback: TransactionCallback = ({ stage, payload }) => {
  switch (stage) {
    case TransactionCallbackStage.SIGN:
      console.log('wait for sign');
      break;
    case TransactionCallbackStage.RECEIPT:
      console.log('wait for receipt');
      console.log(payload, 'transaction hash');
      break;
    case TransactionCallbackStage.CONFIRMATION:
      console.log('wait for confirmation');
      console.log(payload, 'transaction receipt');
      break;
    case TransactionCallbackStage.DONE:
      console.log('done');
      console.log(payload, 'transaction confirmations');
      break;
    case TransactionCallbackStage.ERROR:
      console.log('error');
      console.log(payload, 'error object with code and message');
      break;
    default:
  }
};

// Define missing variables
const value = BigInt('1000000000000000000'); // 1 ETH in wei
const account = '0xYourAccountAddress' as Address; // Your account address


async function stakeWithLido() {
try {
  const wrapTx = await lidoSDK.staking.wrapETH({
    value,
    callback,
    account,
  });

  console.log(
    wrapTx,
    'transaction hash, transaction receipt, confirmations, wrap result',
    wrapTx.result.stethWrapped,
    wrapTx.result.wstethReceived,
  );
} catch (error) {
  console.log((error as SDKError).errorMessage, (error as SDKError).code);
}
}

// Call the function
stakeWithLido();