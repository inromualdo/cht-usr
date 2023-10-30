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
  state?: workbookuploadState;
};

export enum uploadState {
  SUCCESS = "success",
  FAILURE = "failure",
  PENDING = "pending",
}

export type workbookuploadState = {
  id: string;
  state: "in_progress" | "done";
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
