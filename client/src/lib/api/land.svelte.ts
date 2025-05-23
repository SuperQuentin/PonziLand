import { useDojo } from '$lib/contexts/dojo';
import data from '$profileData';
import type { LandYieldInfo, Token } from '$lib/interfaces';
import {
  type Auction,
  type Land,
  type LandStake,
  type SchemaType as PonziLandSchemaType,
  ModelsMapping,
} from '$lib/models.gen';
import { ensureNumber, getTokenInfo, toHexWithPadding } from '$lib/utils';
import { CurrencyAmount } from '$lib/utils/CurrencyAmount';
import { fromDojoLevel } from '$lib/utils/level';
import { estimateNukeTime } from '$lib/utils/taxes';
import {
  QueryBuilder,
  ToriiQueryBuilder,
  type StandardizedQueryResult,
  type SubscribeParams,
} from '@dojoengine/sdk';
import { toNumber } from 'ethers';
import type { BigNumberish } from 'starknet';
import {
  derived,
  get,
  writable,
  type Readable,
  readonly,
  type Writable,
  readable,
} from 'svelte/store';
import { Neighbors } from './neighbors';
import { GAME_SPEED, LEVEL_UP_TIME } from '$lib/const';
import { notificationQueue } from '$lib/stores/event.store.svelte';
import { poseidonHash } from '@dojoengine/torii-client';
import { updated } from '$app/stores';

export type TransactionResult = Promise<
  | {
      transaction_hash: string;
    }
  | undefined
>;

export type Level = 1 | 2 | 3;

export type LandWithStake = Land & LandStake;
export type LandAuction = Land & Auction;

export type LandSetup = {
  tokenForSaleAddress: string;
  salePrice: CurrencyAmount;
  amountToStake: CurrencyAmount;
  tokenAddress: string;
  currentPrice: CurrencyAmount | null;
};

export type LandsStore = Readable<LandWithActions[]> & {
  /// Buy a land from another player
  buyLand(location: BigNumberish, setup: LandSetup): TransactionResult;
  /// Buy an empty / nuked land.
  /// NOTE: This function may be removed later.
  bidLand(location: BigNumberish, setup: LandSetup): TransactionResult;
};

export type LandWithMeta = Omit<
  Land | LandWithStake | LandAuction,
  'location' | 'level'
> & {
  location: string;
  // Type conversions
  stakeAmount: CurrencyAmount;
  lastPayTime: number;
  sellPrice: CurrencyAmount;

  type: 'auction' | 'house' | 'grass';
  owner: string;

  level: Level;

  tokenUsed: string | null;
  tokenAddress: string | null;

  token?: Token;
};

export type PendingTax = {
  amount: CurrencyAmount;
  tokenAddress: string;
};

export type NextClaimInformation = {
  amount: CurrencyAmount;
  tokenAddress: string;
  landLocation: string;
  canBeNuked: boolean;
};

export type LevelInfo = {
  canLevelUp: boolean;
  expectedLevel: Level;
  timeSinceLastLevelUp: number;
  levelUpTime: number;
};

export type LandWithActions = LandWithMeta & {
  wait(): Promise<void>;
  increaseStake(amount: CurrencyAmount): TransactionResult;
  increasePrice(amount: CurrencyAmount): TransactionResult;
  claim(): TransactionResult;
  getPendingTaxes(): Promise<PendingTax[] | undefined>;
  getNextClaim(): Promise<NextClaimInformation[] | undefined>;
  getNukable(): Promise<number | undefined>;
  getCurrentAuctionPrice(): Promise<CurrencyAmount | undefined>;
  getYieldInfo(): Promise<LandYieldInfo | undefined>;
  getEstimatedNukeTime(): number | undefined;
  getNeighbors(): Neighbors;
  levelUp(): TransactionResult;
  getLevelInfo(): LevelInfo;
};

export function useLands(): LandsStore | undefined {
  // Get all lands in the store
  if (typeof window === 'undefined') {
    // We are on the server. Return nothing.
    return undefined;
  }

  const { store, client: sdk, accountManager } = useDojo();

  const landStore = derived([store], ([actualStore]) => actualStore);

  // We are using this to ensure that we are getting the latest provider, not an old one.
  const account = () => {
    return accountManager!.getProvider();
  };

  (async () => {
    // also query initial
    let response: StandardizedQueryResult<PonziLandSchemaType> = [];
    let page = 0;
    do {
      const pagedQuery = ToriiQueryBuilder.withPagination(page, 100)
        .addEntityModel(ModelsMapping.Land)
        .addEntityModel(ModelsMapping.Auction)
        .addEntityModel(ModelsMapping.LandStake)
        .includeHashedKeys();

      response = await sdk.getEntities({
        query: pagedQuery,
      });
      get(landStore).setEntities(response);

      page++;
    } while (response.length != 0);

    const baseQuery = new ToriiQueryBuilder()
      .addEntityModel(ModelsMapping.Land)
      .addEntityModel(ModelsMapping.Auction)
      .addEntityModel(ModelsMapping.LandStake)
      .includeHashedKeys();

    // Subscribe to updates
    await sdk.subscribeEntityQuery({
      query: baseQuery,
      callback: (response) => {
        if (response.error || response.data == null) {
          console.log('Got an error!', response.error);
        } else {
          get(landStore).mergeEntities(response.data);
        }
      },
      options: {
        logging: true,
      },
    } as SubscribeParams<PonziLandSchemaType>);
  })();

  const landEntityStore = derived([landStore], ([s]) => {
    const landsStakes = s
      .getEntitiesByModel('ponzi_land', 'LandStake')
      .map((e) => e.models['ponzi_land']['LandStake'] as LandStake);

    const auctions = s
      .getEntitiesByModel('ponzi_land', 'Auction')
      .map((e) => e.models['ponzi_land']['Auction'] as Auction);

    const lands: (LandWithStake | Land)[] = s
      .getEntitiesByModel('ponzi_land', 'Land')
      .map((e) => {
        const land = e.models['ponzi_land']['Land'] as Land;
        const landStake = landsStakes.find(
          (stake) => stake.location === land.location,
        );
        const auction = auctions.find(
          (auction) => auction.land_location === land.location,
        );

        return {
          ...land,
          ...(landStake ?? {}),
          ...(auction ?? {}),
        };
      });

    const landWithActions: LandWithActions[] = lands
      .map((land) => {
        // ------------------------
        // Land With Meta data here
        // ------------------------
        //

        const token = data.availableTokens.find(
          (token) => token.address === land.token_used,
        );

        const landStake: LandWithStake | null = 'amount' in land ? land : null;

        return {
          ...land,
          location: toHexWithPadding(ensureNumber(land.location)),
          type: (land.owner == toHexWithPadding(0) ? 'auction' : 'house') as
            | 'auction'
            | 'house',
          owner: land.owner,
          level: fromDojoLevel(land.level),
          sellPrice: CurrencyAmount.fromUnscaled(land.sell_price),
          tokenUsed: getTokenInfo(land.token_used)?.name ?? 'Unknown Token',
          tokenAddress: land.token_used,
          stakeAmount: CurrencyAmount.fromUnscaled(landStake?.amount ?? 0),
          lastPayTime: landStake?.last_pay_time
            ? Number(landStake.last_pay_time)
            : 0,
          token,
        };
      })
      .map((land) => ({
        ...land,

        // Add functions
        async increaseStake(amount: CurrencyAmount) {
          let res = await sdk.client.actions.increaseStake(
            account()?.getWalletAccount()!,
            land.location,
            land.token_used,
            amount.toBignumberish(),
          );
          notificationQueue.addNotification(
            res?.transaction_hash ?? null,
            'increase stake',
          );
          return res;
        },
        async wait() {
          // Wait until the land changes
          let id = poseidonHash([land.location]);
          await store.getState().waitForEntityChange(
            id,
            (val) => {
              let parsedLand = val?.models?.['ponzi_land']?.['Land'] as
                | Land
                | undefined;
              return (
                parsedLand != undefined && parsedLand.location == land.location
              );
            },
            15 * 1000, // ms
          );
        },
        async increasePrice(amount: CurrencyAmount) {
          let res = await sdk.client.actions.increasePrice(
            account()?.getWalletAccount()!,
            land.location,
            amount.toBignumberish(),
          );
          notificationQueue.addNotification(
            res?.transaction_hash ?? null,
            'increase price',
          );
          return res;
        },
        async claim() {
          let res = await sdk.client.actions.claim(
            account()?.getAccount()!,
            land.location,
          );
          notificationQueue.addNotification(
            res?.transaction_hash ?? null,
            'claim',
          );
          return res;
        },
        async getPendingTaxes() {
          const result = (await sdk.client.actions.getPendingTaxesForLand(
            land.location,
            account()!.getWalletAccount()!.address,
          )) as any[] | undefined;

          return result?.map((tax) => ({
            amount: CurrencyAmount.fromUnscaled(tax.amount),
            tokenAddress: toHexWithPadding(tax.token_address),
          }));
        },
        async getNextClaim() {
          const result = (await sdk.client.actions.getNextClaimInfo(
            land.location,
          )) as any[] | undefined;
          return result?.map((claim) => ({
            amount: CurrencyAmount.fromUnscaled(claim.amount),
            tokenAddress: toHexWithPadding(claim.token_address),
            landLocation: toHexWithPadding(claim.land_location),
            canBeNuked: claim.can_be_nuked,
          }));
        },
        async getNukable() {
          const result = (await sdk.client.actions.getTimeToNuke(
            land.location,
          )) as unknown as number | undefined;
          return result;
        },
        async getCurrentAuctionPrice() {
          return CurrencyAmount.fromUnscaled(
            (await sdk.client.actions.getCurrentAuctionPrice(
              land.location,
            ))! as string,
          );
        },
        async getYieldInfo() {
          const result = (await sdk.client.actions.getNeighborsYield(
            land.location,
          )) as LandYieldInfo | undefined;

          return result;
        },
        async levelUp() {
          return await sdk.client.actions.levelUp(
            account()?.getAccount()!,
            land.location,
          );
        },
        getEstimatedNukeTime() {
          return estimateNukeTime(
            land as LandWithActions,
            new Neighbors({
              location: land.location,
              source: landWithActions,
            }).getNeighbors().length,
          );
        },
        getNeighbors() {
          return new Neighbors({
            location: land.location,
            source: landWithActions,
          });
        },

        getLevelInfo() {
          const now = Math.floor(Date.now() / 1000);
          const boughtSince =
            (now - Number(land.block_date_bought)) * GAME_SPEED;

          const expectedLevel = Math.min(
            Math.floor(boughtSince / LEVEL_UP_TIME) + 1,
            3,
          ) as Level;
          const timeSinceLastLevelUp = boughtSince % LEVEL_UP_TIME;
          const levelUpTime = expectedLevel < 3 ? LEVEL_UP_TIME : 0;

          return {
            canLevelUp: expectedLevel > land.level,
            expectedLevel,
            timeSinceLastLevelUp,
            levelUpTime,
          };
        },
      }));

    return landWithActions;
  });

  let hasUpdated = false;

  const landEntityDebouncedStore = readable<LandWithActions[]>([], (set) => {
    // Subscribe to land store updates
    let lastState: LandWithActions[] | null = null;
    let subscription = landEntityStore.subscribe((land) => {
      lastState = land;
    });

    const id = setInterval(() => {
      if (lastState != null) {
        console.log('Updating state!');
        set(lastState);
        lastState = null;
      }
    }, 250);

    return () => clearInterval(id);
  });

  return {
    ...landEntityDebouncedStore,
    async buyLand(location, setup) {
      let res = await sdk.client.actions.buy(
        account()?.getWalletAccount()!,
        location,
        setup.tokenForSaleAddress,
        setup.salePrice.toBignumberish(),
        setup.amountToStake.toBignumberish(),
        setup.tokenAddress,
        setup.currentPrice!.toBignumberish(),
      );
      notificationQueue.addNotification(
        res?.transaction_hash ?? null,
        'buy land',
      );
      return res;
    },

    // TODO(#53): Split this action in two, and migrate the call to the session account
    async bidLand(location, setup) {
      let res = await sdk.client.actions.bid(
        account()?.getWalletAccount()!,
        location,
        setup.tokenForSaleAddress,
        setup.salePrice.toBignumberish(),
        setup.amountToStake.toBignumberish(),
        setup.tokenAddress,
        setup.currentPrice!.toBignumberish(),
      );
      notificationQueue.addNotification(
        res?.transaction_hash ?? null,
        'buy land',
      );
      return res;
    },
  };
}
