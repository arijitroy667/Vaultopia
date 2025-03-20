import { LidoSDK, LidoSDKStake,LIDO_CONTRACT_NAMES,LidoSDKCore,LidoSDKWithdraw,LidoSDKWrap,LidoSDKstETH,LidoSDKwstETH,LidoSDKUnstETH,LidoSDKShares,LidoSDKStatistics,LidoSDKRewards } from '@lidofinance/lido-ethereum-sdk';
import { createPublicClient, createWalletClient, http, Address, PublicClient, encodeFunctionData } from 'viem';
import { holesky } from 'viem/chains';
import { custom } from 'viem';
import vaultProvider  from './web3Provider';

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
  web3Provider: walletClient,
});


const stethAddress = await lidoSDK.core.getContractAddress(
    LIDO_CONTRACT_NAMES.lido,
  );
  const wsteth = await lidoSDK.core.getContractAddress(
    LIDO_CONTRACT_NAMES.wsteth,
  );