// src/app/services/password.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from './environnement'; // ✅ Chemin à vérifier selon ton arborescence

@Injectable({ providedIn: 'root' })
export class PasswordService {
  // ✅ On utilise la variable centralisée
  // J'ajoute '/auth/password' pour correspondre à ta structure de route backend
  private apiUrl = `${environment.apiUrl}/auth/password`;

  constructor(private http: HttpClient) {}

  updatePassword(email: string, newPassword: string): Observable<any> {
    return this.http.post(this.apiUrl, { email, newPassword });
  }
}
