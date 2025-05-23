import type { CurrencyAmount } from '$lib/utils/CurrencyAmount';
import { writable } from 'svelte/store';
import { useAccount } from '$lib/contexts/account.svelte';

export type ClaimEvent = CurrencyAmount;

export const claimQueue = writable<ClaimEvent[]>([]);

let accountManager = $derived(useAccount());

class NotificationQueue {
  public queue: {
    txCount: number;
    pending: boolean;
    txhash: string | null;
    isValid: boolean | null;
    functionName: string;
  }[] = $state([]);

  private txCount = 0;

  public getQueue() {
    return this.queue;
  }

  public registerNotification(functionName: string) {
    this.txCount++;
    this.queue.push({
      txCount: this.txCount,
      pending: true,
      txhash: null,
      isValid: null,
      functionName,
    });
    return this.queue[this.queue.length - 1];
  }

  public async addNotification(txhash: string | null, functionName: string) {
    const notification = this.registerNotification(functionName);
    if (txhash) {
      await accountManager!
        .getProvider()
        ?.getWalletAccount()
        ?.waitForTransaction(txhash);
      notification.txhash = txhash;
      notification.isValid = true;
      notification.pending = false;
    } else {
      notification.isValid = false;
      notification.pending = false;
    }

    setTimeout(() => this.removeNotification(notification.txCount), 3600);
  }
  public removeNotification(txCount: number) {
    this.queue = this.queue.filter((n) => n.txCount !== txCount);
  }
}

export const notificationQueue = new NotificationQueue();
