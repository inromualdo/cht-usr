export type person = {
  id: string;
  remoteId?: string;
  name: string;
  phone: string;
  sex: string;
  role: string;
};

export type place = {
  id: string;
  remoteId?: string;
  name: string;
  type: string;
  contact: string;
  action: "create" | "replace_contact"; // we def need another model now
  parent?: {
    id: string;
    name: string;
  };
};

export type jobState = {
  id: string;
  status: uploadState;
};

export type displayPlace = {
  place: place;
  contact: person;
  state: jobState;
};

export type workBookState = {
  id: string;
  places: Map<string, string[]>;
  state?: workbookuploadState;
};

export enum uploadState {
  SUCCESS = "success",
  FAILURE = "failure",
  PENDING = "pending",
}

export type workbookuploadState = {
  id: string;
  state: "in_progress" | "done" | "pending";
};

export type userCredentials = {
  user: string;
  pass: string;
  place: string;
  contact: string;
};

export type placeWithCreds = {
  placeName: string;
  placeType: string;
  placeParent?: string;
  contactName: string;
  creds: userCredentials;
};
