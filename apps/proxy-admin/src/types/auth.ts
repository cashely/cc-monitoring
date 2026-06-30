export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
}

export interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface AuthContextType extends AuthState {
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
}
