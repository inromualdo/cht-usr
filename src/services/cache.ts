import {
  PersonPayload,
  PlacePayload,
  PlaceSearchResult,
  UserPayload,
} from "../lib/cht";
import { Hierarchy } from "../lib/utils";
import {
  workBookState,
  uploadState,
  place,
  person,
  workbookuploadState,
  userCredentials,
  placeWithCreds,
} from "./models";

export class MemCache {
  private hierarchy: Hierarchy;
  private userRoles: string[];
  private workbooks: Map<string, workBookState>;
  private searchResultCache: Map<string, PlaceSearchResult> = new Map();
  private idMap: Map<string, string | undefined> = new Map(); //<local> - <remote> place id map
  private jobState: Map<string, uploadState> = new Map();
  private credList: Map<string, userCredentials> = new Map();

  constructor(hierachy: Hierarchy, userRoles: string[]) {
    this.hierarchy = hierachy;
    this.userRoles = userRoles;
    this.workbooks = new Map();
  }

  /**
   *
   * @param name workbook name
   * @returns workbook id
   */
  saveWorkbook = (name: string): string => {
    const id = name.toLowerCase().split(" ").join("");
    const places = Object.keys(this.hierarchy!!).filter(
      (key) => !this.hierarchy!![key].parentPlaceContactType
    );
    const active = places[0];
    const workflowState: workBookState = { id: id, places: new Map() };
    workflowState.places.set(active, []);
    this.workbooks.set(id, workflowState);
    return id;
  };

  /**
   *
   * @param id workbook id
   * @returns workBookState
   */
  getWorkbook = (id: string): workBookState => {
    const workbook = this.workbooks.get(id);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    return workbook;
  };

  /**
   *
   * @returns a list of workbook ids
   */
  getWorkbooks = (): string[] => {
    return Array.from(this.workbooks.keys());
  };

  /**
   *
   * @param workbookId
   * @param data place data
   */
  savePlace = (workbookId: string, data: place) => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    const places = workbook.places.get(data.type) || [];
    places.push(data);
    this.idMap.set(data.id, undefined);
    this.idMap.set(data.contact.id!!, undefined);
    workbook.places.set(data.type, places);
    if (workbook.state) {
      workbook.state.state = "pending";
    }
  };

  /**
   *
   * @param workbookId workbbook the place belongs to
   * @param placeType
   * @param placeId
   * @returns place
   */
  getPlace = (
    workbookId: string,
    placeType: string,
    placeId: string
  ): place | undefined => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    const place = (workbook.places.get(placeType) || []).find(
      (place) => place.id === placeId
    )!!;
    if (place) {
      if (this.jobState.has(place.id!!)) {
        const state = this.jobState.get(place.id!!);
        if (state) {
          place.state = { status: state.toString() };
        }
      }
    }
    return place;
  };

  /**
   *
   * @param workbookId
   * @returns list of places in the workbook
   */
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

  /**
   *
   * @param hierarchy
   */
  setHierarchy = (hierarchy: Hierarchy) => {
    this.hierarchy = hierarchy;
  };

  /**
   *
   * @returns list of place contact types in the hierarchy
   */
  getPlaceTypes = (): string[] => {
    return Object.keys(this.hierarchy!!);
  };

  /**
   *
   * @param roles
   */
  setUserRoles = (roles: string[]) => {
    this.userRoles = roles;
  };

  /**
   *
   * @returns list of configured user roles for the project
   */
  getUserRoles = (): string[] => {
    return this.userRoles!!;
  };

  /**
   *
   * @param placeType
   * @returns the parent place contact type if any
   */
  getParentType = (placeType: string): string | undefined => {
    return this.hierarchy!![placeType].parentPlaceContactType;
  };

  findPlace = async (
    workbookId: string,
    placeType: string,
    searchStr: string
  ): Promise<PlaceSearchResult[]> => {
    const workbook = this.getWorkbook(workbookId);
    return workbook.places
      .get(placeType)!!
      .filter(
        (place) =>
          place.name.toUpperCase().includes(searchStr.toUpperCase()) &&
          !this.getRemoteId(place.id!!)
      )
      .map((place) => {
        return { id: place.id!!, name: place.name };
      });
  };

  cacheRemoteSearchResult = (results: PlaceSearchResult[]) => {
    results.forEach((place) => {
      this.setRemoteId(place.id, place.id);
      this.searchResultCache.set(place.id, place);
    });
  };

  getCachedSearchResult = (
    id: string,
    workbook: string
  ): PlaceSearchResult | undefined => {
    let result = this.searchResultCache.get(id);
    if (!result) {
      const place = this.getPlaces(workbook).find(
        (place) => !this.getRemoteId(place.id!!) && place.id === id
      );
      if (place) result = { id: place.id!!, name: place.name };
    }
    return result;
  };

  setRemoteId = (localId: string, id: string) => {
    this.idMap.set(localId, id);
  };

  getRemoteId = (id: string): string | undefined => {
    return this.idMap.get(id);
  };

  setJobState = (jobId: string, status: uploadState) => {
    this.jobState.set(jobId, status);
  };

  setUserCredentials = (placeId: string, creds: userCredentials) => {
    this.credList.set(placeId, creds);
  };

  getUserCredentials = (workbookId: string): placeWithCreds[] => {
    return this.getPlaces(workbookId)
      .filter((place) => place.state?.status === uploadState.SUCCESS)
      .map((place) => {
        return {
          placeName: place.name,
          placeType: place.type,
          placeParent: place.parent?.name,
          contactName: place.contact.name,
          creds: this.credList.get(place.id!!)!!,
        } as placeWithCreds;
      });
  };

  setWorkbookUploadState = (id: string, state: workbookuploadState) => {
    this.workbooks.get(id)!!.state = state;
  };

  getWorkbookState = (id: string): workbookuploadState | undefined => {
    return this.workbooks.get(id)!!.state;
  };

  getPlaceByUploadState = (
    workbookId: string,
    state?: uploadState
  ): place[] => {
    return this.getPlaces(workbookId).filter((place) =>
      state ? place.state?.status === state : !place.state
    );
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

  buildContactPayload = (
    person: person,
    placeType: string,
    parent?: string
  ): PersonPayload => {
    return {
      name: person.name,
      phone: person.phone,
      sex: person.sex,
      type: "contact",
      contact_type: this.hierarchy!![placeType].personContactType!!,
      place: parent,
    };
  };

  buildPlacePayload = (place: place): PlacePayload => {
    const data: PlacePayload = {
      name: place.name,
      type: "contact",
      contact_type: place.type,
      contact: this.buildContactPayload(
        place.contact,
        place.type,
        place.action === "replace_contact" ? place.id : undefined
      ),
    };
    if (place.parent) {
      data.parent = this.getRemoteId(place.parent.id);
    }
    return data;
  };
}
