import {
  ChtApi,
  PersonPayload,
  PlacePayload,
  PlaceSearchResult,
  UserPayload,
} from "../lib/cht";
import { Hierarchy } from "../lib/utils";
import { v4 as uuidv4 } from "uuid";

export type person = {
  id?: string;
  name: string;
  phone: string;
  sex: string;
  role: string;
};

export type place = {
  id?: string;
  name: string;
  type: string;
  contact: person;
  parent?: {
    id: string;
    name: string;
  };
  state?: {
    status: string;
  };
};

export type workBookState = {
  id: string;
  places: Map<string, place[]>;
};

export enum jobStatus {
  SUCCESS = "success",
  FAILURE = "failure",
  PENDING = "pending",
}

export class MemCache {
  private chtApi: ChtApi;
  private hierarchy: Hierarchy;
  private userRoles: string[];
  private workbooks: Map<string, workBookState>;
  private searchResultCache: Map<string, PlaceSearchResult> = new Map();
  private idMap: Map<string, string | undefined> = new Map(); //<local> - <remote> place id map
  private jobState: Map<string, jobStatus> = new Map();

  constructor(chtApi: ChtApi, hierarchy: Hierarchy, roles: string[]) {
    this.chtApi = chtApi;
    this.userRoles = roles;
    this.hierarchy = hierarchy;
    this.workbooks = new Map();
  }

  newWorkbook = (name: string): string => {
    const id = name.toLowerCase().split(" ").join("");
    const places = Object.keys(this.hierarchy).filter(
      (key) => !this.hierarchy!![key].parentPlaceContactType
    );
    const active = places[0];
    const workflowState: workBookState = { id: id, places: new Map() };
    workflowState.places.set(active, []);
    this.workbooks.set(id, workflowState);
    return id;
  };

  getWorkbooks = (): string[] => {
    return Array.from(this.workbooks.keys());
  };

  getWorkbookState = (id: string): workBookState => {
    const workbook = this.workbooks.get(id);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    return workbook;
  };

  addPlace = (workbookId: string, data: place) => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    const id = uuidv4();
    data.id = "place::" + id;
    data.contact.id = "person::" + id;
    const places = workbook.places.get(data.type) || [];
    places.push(data);
    this.idMap.set(data.id, undefined);
    this.idMap.set(data.contact.id, undefined);
    workbook.places.set(data.type, places);
  };

  getPlaces = (workbookId: string): place[] => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    const places: place[] = [];
    for (const placeType of this.getPlaceTypes()) {
      const data = workbook.places.get(placeType) || [];
      data.forEach((place) => {
        if (this.jobState.has(place.id!!)) {
          const state = this.jobState.get(place.id!!);
          if (state) {
            place.state = { status: state.toString() };
          }
        }
        places.push(place);
      });
    }
    return places;
  };

  getPlace = (
    workbookId: string,
    placeType: string,
    placeId: string
  ): place => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    return workbook.places
      .get(placeType)!!
      .find((place) => place.id === placeId)!!;
  };

  getPlaceTypes = (): string[] => {
    return Object.keys(this.hierarchy!!);
  };

  getUserRoles = (): string[] => {
    return this.userRoles!!;
  };

  getParentType = (placeType: string): string | undefined => {
    return this.hierarchy!![placeType].parentPlaceContactType;
  };

  findPlace = async (
    workbookId: string,
    placeType: string,
    searchStr: string
  ): Promise<PlaceSearchResult[]> => {
    const localResults = this.getPlaces(workbookId)
      .filter((place) => place.name.includes(searchStr))
      .map((place) => {
        return { id: place.id!!, name: place.name };
      });
    const remoteResults = await this.chtApi.searchPlace(placeType, searchStr);
    remoteResults.forEach((result) => this.setRemoteId(result.id, result.id));
    const results: PlaceSearchResult[] = localResults.concat(remoteResults);
    results.forEach((place) => {
      this.searchResultCache.set(place.id, place);
    });
    return results;
  };

  getCachedResult = (id: string): PlaceSearchResult | undefined => {
    return this.searchResultCache.get(id);
  };

  setRemoteId = (localId: string, id: string) => {
    this.idMap.set(localId, id);
  };

  getRemoteId = (id: string): string | undefined => {
    return this.idMap.get(id);
  };

  setJobState = (jobId: string, status: jobStatus) => {
    this.jobState.set(jobId, status);
  };

  buildUserPayload = (
    placeId: string,
    contactId: string,
    contactName: string,
    role: string
  ): UserPayload => {
    const data: UserPayload = {
      username: contactName.toLowerCase().split(" ").join("_"),
      password: "medic@1234!",
      type: role,
      place: placeId,
      contact: contactId,
    };
    return data;
  };

  buildPersonPayload = (contactType: string, person: person): PersonPayload => {
    return {
      name: person.name,
      phone: person.phone,
      sex: person.sex,
      type: "contact",
      contact_type: contactType,
    };
  };

  buildPlacePayload = (place: place): PlacePayload => {
    const data: PlacePayload = {
      name: place.name,
      type: "contact",
      contact_type: place.type,
      contact: this.buildPersonPayload(
        this.hierarchy[place.type].personContactType!!,
        place.contact
      ),
    };
    if (place.parent) {
      data.parent = this.getRemoteId(place.parent.id);
    }
    return data;
  };
}
