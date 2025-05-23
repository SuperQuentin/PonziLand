<script lang="ts">
  import { setupAccount } from '$lib/contexts/account.svelte';
  import { setupClient } from '$lib/contexts/client.svelte';
  import { setupStore } from '$lib/contexts/store.svelte';
  import { dojoConfig } from '$lib/dojoConfig';
  import Map from '$lib/components/map/map.svelte';
  import Ui from '$lib/components/ui.svelte';
  import LoadingScreen from '$lib/components/loading/loading-screen.svelte';
  import SwitchChainModal from '$lib/components/wallet/SwitchChainModal.svelte';
  import { particlesInit } from '@tsparticles/svelte';
  import { loadFull } from 'tsparticles';
  import { tsParticles } from '@tsparticles/engine';
  import { loadImageShape } from '@tsparticles/shape-image';
  import { setupSocialink } from '$lib/accounts/social/index.svelte';
  import Register from '$lib/components/socialink/register.svelte';
  import { setup as setupAccountState, refresh } from '$lib/account.svelte';
  import Invitation from '$lib/components/socialink/Invitation.svelte';
  import { goto } from '$app/navigation';

  void particlesInit(async (engine) => {
    await loadFull(engine);
  });

  (async () => {
    await loadImageShape(tsParticles);
  })();

  const promise = Promise.all([
    setupSocialink().then(() => {
      return setupAccountState();
    }),
    setupClient(dojoConfig),
    setupAccount(),
    setupStore(),
  ]);

  let loading = $state(true);

  let value = $state(10);

  $effect(() => {
    let increment = 10;

    const interval = setInterval(() => {
      value += increment;
      if (increment > 1) {
        increment = increment - 1;
      }
      if (value >= 80) {
        clearInterval(interval);
      }
    }, 100);

    function clearLoading() {
      clearInterval(interval);
      value = 100;
      setTimeout(() => {
        loading = false;
      }, 200);
    }

    promise
      .then(async ([accountState, dojo, accountManager]) => {
        if (accountState == null) {
          console.error('Account state is null!');

          return;
        }

        if (accountManager?.getProvider()?.getAccount() == null) {
          console.info('The user is not logged in! Attempting login.');
          await accountManager?.getProvider()?.connect();
        }

        // Check if the user needs to signup with socialink
        const address = accountManager
          ?.getProvider()
          ?.getWalletAccount()?.address;

        // Make sure that we finished updating the user signup state.
        await refresh();

        // Check if the user needs to signup with socialink
        if (address != null && !accountState.profile?.exists) {
          console.info('The user needs to signup with socialink.');
          goto('/onboarding/register');
          return;
        }

        if (
          address != null &&
          accountState.profile?.exists &&
          !accountState.profile?.whitelisted
        ) {
          console.info('The user needs to get whitelisted.');
          goto('/onboarding/whitelist');
          return;
        }

        console.log('Everything is ready!', dojo != undefined);

        clearLoading();
      })
      .catch((err) => {
        console.error('An error occurred:', err);
        // TODO: Redirect to an error page!
      });
  });
</script>

<div class="h-screen w-screen bg-black/10 overflow-visible">
  <SwitchChainModal />

  {#if loading}
    <LoadingScreen {value} />
  {:else}
    <Map />
    <Ui />
  {/if}
</div>
