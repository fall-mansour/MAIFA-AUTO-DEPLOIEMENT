// FICHIER : pieces.service.ts (ou pieces.ts selon votre import)
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from './environnement';

export interface Piece {
  id?: number;
  _id?: string;
  marque: string;
  modele: string;
  categorie: string;
  description: string;
  prix: number;
  quantite: number;
  annee: number;
  etat?: string;

  img_principale?: string;
  img_url?: string; // Important pour l'affichage Node.js
}

@Injectable({
  providedIn: 'root',
})
export class PiecesService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // CETTE MÉTHODE DOIT ÊTRE ICI SANS FAUTE
  getPiecesAcceuil(): Observable<Piece[]> {
    return this.http.get<Piece[]>(`${this.apiUrl}/acceuil`);
  }

  getPieces(): Observable<Piece[]> {
    return this.http.get<Piece[]>(`${this.apiUrl}/pieces`);
  }

  deletePiece(id: string | number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/pieces/${id}`);
  }
}
