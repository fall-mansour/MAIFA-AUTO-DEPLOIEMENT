import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from './environnement';

// Interface bien alignée avec les colonnes de ta base de données
export interface Piecevente {
  id: number;
  marque: string;
  modele: string;
  categorie: string;
  description: string;
  prix: number;
  annee: number;
  img_principale: string;
  img1: string; // Galerie
  img2: string; // Galerie
  img3?: string; // Optionnel
  img4?: string;
  img_url?: string;
  fournisseur?: string;
  etat?: string;
  quantite?: number;
  slug?: string; // Pour les URLs conviviales
}

@Injectable({
  providedIn: 'root',
})
export class PiecesServicevente {
  // Utilisation de l'URL définie dans l'environnement
  private apiUrl = `${environment.apiUrl}/acceuil`;

  constructor(private http: HttpClient) {}

  /**
   * Récupère la liste des pièces pour la page d'accueil
   */
  getPieces(): Observable<Piecevente[]> {
    return this.http.get<Piecevente[]>(this.apiUrl).pipe(
      catchError((error) => {
        console.error('❌ Erreur lors de la récupération des pièces :', error);
        return throwError(() => new Error('Impossible de charger les pièces.'));
      }),
    );
  }
}
