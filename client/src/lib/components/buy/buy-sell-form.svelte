<script lang="ts">
  import data from '$profileData';
  import type { Token } from '$lib/interfaces';
  import { selectedLand } from '$lib/stores/stores.svelte';
  import { CurrencyAmount } from '$lib/utils/CurrencyAmount';
  import { onMount } from 'svelte';
  import { Input } from '../ui/input';
  import Label from '../ui/label/label.svelte';
  import { Select, SelectContent } from '../ui/select';
  import SelectItem from '../ui/select/select-item.svelte';
  import SelectTrigger from '../ui/select/select-trigger.svelte';
  import BuyInsights from './buy-insights.svelte';
  import { tokenStore } from '$lib/stores/tokens.svelte';

  let {
    selectedToken = $bindable<Token | undefined>(),
    stakeAmount = $bindable<CurrencyAmount>(),
    sellAmount = $bindable<CurrencyAmount>(),
  }: {
    selectedToken: Token | undefined;
    stakeAmount: CurrencyAmount;
    sellAmount: CurrencyAmount;
  } = $props();

  let stakeAmountVal = $state(stakeAmount.toString());
  let stakeAmountError = $derived.by(() => {
    let parsedStake = parseFloat(stakeAmountVal);

    if (isNaN(parsedStake) || parsedStake < 0) {
      return 'Stake amount must be a number greater than 0';
    }

    // get selected token balance from tokenStore balance
    const selectedTokenBalance = tokenStore.balances.find(
      (balance) => balance.token.address == selectedToken?.address,
    );

    if (selectedTokenBalance == undefined) {
      return "You don't have any of this token";
    }

    const selectedTokenAmount = CurrencyAmount.fromUnscaled(
      selectedTokenBalance?.balance,
      selectedToken,
    );

    if (
      selectedToken &&
      selectedTokenAmount.rawValue().isLessThanOrEqualTo(parsedStake)
    ) {
      return `You don't have enough ${selectedToken.symbol} to stake (max: ${selectedTokenAmount.toString()})`;
    }
  });
  let sellAmountVal = $state(sellAmount.toString());

  $effect(() => {
    if (selectedToken == undefined) {
      selectedToken = data.availableTokens.find((t) => t.symbol == 'eSTRK');
    }
  });

  $effect(() => {
    stakeAmount = CurrencyAmount.fromScaled(stakeAmountVal);
  });

  $effect(() => {
    stakeAmount = CurrencyAmount.fromScaled(stakeAmountVal);
    sellAmount = CurrencyAmount.fromScaled(sellAmountVal);
  });
</script>

<div class="w-full flex flex-col gap-2 text-stroke-none">
  <Label class="text-lg font-semibold">Select Token</Label>
  <Select onSelectedChange={(v) => (selectedToken = v?.value as Token)}>
    <SelectTrigger>
      {#if selectedToken}
        <div class="flex gap-2 items-center">
          <img
            class="h-4 w-4"
            src={selectedToken.images.icon}
            alt={selectedToken.symbol}
          />
          {selectedToken.symbol} -
          {selectedToken.name}
        </div>
      {:else}
        Select Token
      {/if}
    </SelectTrigger>
    <SelectContent>
      {#each data.availableTokens as token}
        <SelectItem value={token}>
          <div class="flex gap-2 items-center">
            <img class="h-4 w-4" src={token.images.icon} alt={token.symbol} />
            {token.symbol} -
            {token.name}
          </div>
        </SelectItem>
      {/each}
    </SelectContent>
  </Select>
  <button
    class="flex items-center gap-2 my-2 text-lg text-[#1F75BC] hover:opacity-75 disabled:opacity-50"
    disabled
  >
    <div class="w-6 h-6 bg-[#1F75BC] relative">
      <div
        class="w-4 h-1 bg-white absolute left-1/2 top-1/2"
        style="transform: translate(-50%, -50%);"
      ></div>
      <div
        class="w-4 h-1 bg-white absolute left-1/2 top-1/2"
        style="transform: translate(-50%, -50%) rotate(-90deg); transform-origin: 50% 50%;"
      ></div>
    </div>
    Add Token Manually ◭ coming soon ◭
  </button>
  <div class="flex gap-2">
    <div>
      <Label class="text-lg font-semibold">Stake Amount</Label>
      <Input
        type="number"
        bind:value={stakeAmountVal}
        class={stakeAmountError ? 'border-red-500 border-2' : ''}
      />
      {#if stakeAmountError}
        <Label>
          <span class="text-red-500">{stakeAmountError}</span>
        </Label>
      {/if}
    </div>
    <div>
      <Label class="text-lg font-semibold">Sell Price</Label>
      <Input type="number" bind:value={sellAmountVal} />
    </div>
  </div>
  {#if $selectedLand}
    <BuyInsights
      {sellAmountVal}
      {stakeAmountVal}
      {selectedToken}
      land={$selectedLand}
    />
  {/if}
</div>
