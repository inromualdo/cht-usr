import { ChtApi, UserPayload } from "../lib/cht";
import { MemCache } from "./cache";
import { workBookState, jobStatus, place } from "./models";

type batch = {
  workbookId: string;
  placeType: string;
  placeIds: string[];
};

export class UploadManager {
  private cache: MemCache;
  private chtApi: ChtApi;
  private callbacks: { (id: string): void }[] = [];
  constructor(chtApi: ChtApi, cache: MemCache) {
    this.cache = cache;
    this.chtApi = chtApi;
  }

  doUpload = (workbookId: string, callback?: { (id: string): void }) => {
    const batches = this.prepareUpload(this.cache.getWorkbook(workbookId)!!);
    if (callback) this.callbacks.push(callback);
    this.upload(batches);
  };

  private prepareUpload = (workbook: workBookState): batch[] => {
    const batches: batch[] = [];
    for (const placeType of this.cache.getPlaceTypes()) {
      const batch: batch = {
        workbookId: workbook.id,
        placeType: placeType,
        placeIds: [],
      };
      workbook.places
        .get(placeType)
        ?.filter(
          (place) => !place.state || place.state!!.status == jobStatus.FAILURE
        )
        .forEach((place) => {
          batch.placeIds.push(place.id!!);
          this.cache.setJobState(place.id!!, jobStatus.PENDING);
        });
      batches.push(batch);
    }
    return batches;
  };

  private upload = async (batches: batch[]) => {
    for (const batch of batches) {
      await this.uploadBatch(batch);
    }
  };

  private uploadBatch = async (job: batch) => {
    for (const placeId of job.placeIds) {
      this.cache.setJobState(placeId, jobStatus.PENDING);
      this.publishEvent();
      try {
        let place = this.cache.getPlace(job.workbookId, job.placeType, placeId);
        const { place: remotePlaceId, contact } = await this.uploadPlace(place);
        this.cache.setJobState(placeId, jobStatus.SUCCESS);
      } catch (err) {
        console.log(err);
        this.cache.setJobState(placeId, jobStatus.FAILURE);
      }
      this.publishEvent();
    }
  };

  private uploadPlace = async (
    placeData: place
  ): Promise<{
    contact: string;
    place: string;
    username: string;
    pass: string;
  }> => {
    let placeId = this.cache.getRemoteId(placeData.id!!);
    if (!placeId) {
      const placePayload = this.cache.buildPlacePayload(placeData);
      placeId = await this.chtApi.createPlace(placePayload);
      this.cache.setRemoteId(placeData.id!!, placeId);
    }

    // why...we don't get a contact id when we create a place with a contact defined.
    // then the created contact doesn't get a parent assigned so we can't create a user for it
    const contactId: string = await this.chtApi.getPlaceContactId(placeId);
    await this.chtApi.updateContactParent(contactId, placeId);

    const userPayload: UserPayload = this.cache.buildUserPayload(
      placeId,
      contactId,
      placeData.contact.name,
      placeData.contact.role
    );
    const { username, pass } = await this.tryCreateUser(userPayload);
    return {
      place: placeId,
      contact: contactId,
      username: username,
      pass: pass,
    };
  };

  private tryCreateUser = async (
    userPayload: UserPayload
  ): Promise<{ username: string; pass: string }> => {
    let retryCount = 0,
      username = userPayload.username;
    do {
      try {
        await this.chtApi.createUser(userPayload);
        return { username: userPayload.username, pass: userPayload.password };
      } catch (err: any) {
        retryCount++;
        console.error("upload manager", err.response.data);
        if (err?.response?.status === 400) {
          const msg = err.response.data;
          if (msg.includes("already taken")) {
            const randomNumber = Math.floor(
              Math.random() * (10 ^ (retryCount + 1))
            );
            username = username.concat(randomNumber.toString());
            userPayload.username = username;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } while (retryCount < 5);
    throw new Error("could not create user " + userPayload.contact);
  };

  listen = (cb: { (id: string): void }) => {
    this.callbacks.push(cb);
  };

  private publishEvent = () => {
    this.callbacks.forEach((cb) => {
      cb("");
    });
  };

  removeListener = (cb: { (id: string): void }) => {
    const idx = this.callbacks.indexOf(cb);
    if (idx > -1) {
      this.callbacks.splice(idx, 1);
    }
  };
}
